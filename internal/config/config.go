package config

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"wansaturator/internal/db"
	"wansaturator/internal/download"
)

const (
	UploadModeS3    = "s3"
	UploadModeHTTP  = "http"
	UploadModeLocal = "local"

	AutoModeReliable = "reliable"
	AutoModeMax      = "max"

	DefaultWebPort             = 7860
	DefaultDownloadMbps        = 5000
	DefaultUploadMbps          = 5000
	DefaultDownloadConcurrency = 8
	DefaultUploadConcurrency   = 4
	DefaultUploadChunkSizeMB   = 10
	DefaultThrottleThreshold   = 60
	DefaultThrottleWindowMin   = 5
	DefaultB2Endpoint          = "https://s3.us-west-002.backblazeb2.com"
)

type Snapshot struct {
	B2KeyID      string `json:"b2KeyId"`
	B2AppKey     string `json:"b2AppKey"`
	B2BucketName string `json:"b2BucketName"`
	B2Endpoint   string `json:"b2Endpoint"`

	WebPort             int `json:"webPort"`
	DefaultDownloadMbps int `json:"defaultDownloadMbps"`
	DefaultUploadMbps   int `json:"defaultUploadMbps"`

	DownloadConcurrency int `json:"downloadConcurrency"`
	UploadConcurrency   int `json:"uploadConcurrency"`
	UploadChunkSizeMB   int `json:"uploadChunkSizeMb"`

	ThrottleThresholdPct int `json:"throttleThresholdPct"`
	ThrottleWindowMin    int `json:"throttleWindowMin"`

	DownloadServers []string `json:"downloadServers"`

	UploadMode      string   `json:"uploadMode"` // "s3", "http", "local"
	UploadEndpoints []string `json:"uploadEndpoints"`

	AutoMode             string  `json:"autoMode"`
	MeasuredDownloadMbps float64 `json:"measuredDownloadMbps"`
	MeasuredUploadMbps   float64 `json:"measuredUploadMbps"`
	LastSpeedTestTime    string  `json:"lastSpeedTestTime"`
}

type Config struct {
	mu sync.RWMutex `json:"-"`
	DB *sql.DB      `json:"-"`
	Snapshot
}

// DefaultDownloadServers is the canonical server list from the download package.
var DefaultDownloadServers = download.DefaultServers

var DefaultUploadEndpoints = []string{
	"https://speed.cloudflare.com/__up",
	"http://speedtest.tele2.net/upload.php",
}

func New(database *sql.DB) *Config {
	c := &Config{
		DB: database,
		Snapshot: Snapshot{
			WebPort:              envInt("WEB_PORT", DefaultWebPort),
			DefaultDownloadMbps:  envInt("DEFAULT_DOWNLOAD_SPEED", DefaultDownloadMbps),
			DefaultUploadMbps:    envInt("DEFAULT_UPLOAD_SPEED", DefaultUploadMbps),
			DownloadConcurrency:  DefaultDownloadConcurrency,
			UploadConcurrency:    DefaultUploadConcurrency,
			UploadChunkSizeMB:    DefaultUploadChunkSizeMB,
			ThrottleThresholdPct: DefaultThrottleThreshold,
			ThrottleWindowMin:    DefaultThrottleWindowMin,
			DownloadServers:      cloneStrings(DefaultDownloadServers),
			UploadMode:           UploadModeHTTP,
			UploadEndpoints:      cloneStrings(DefaultUploadEndpoints),
			AutoMode:             AutoModeReliable,
			B2KeyID:              os.Getenv("B2_KEY_ID"),
			B2AppKey:             os.Getenv("B2_APP_KEY"),
			B2BucketName:         os.Getenv("B2_BUCKET_NAME"),
			B2Endpoint:           os.Getenv("B2_ENDPOINT"),
		},
	}
	c.loadFromDB()
	c.sanitizeLocked()
	return c
}

func (c *Config) loadFromDB() {
	if c.DB == nil {
		return
	}
	if v, _ := db.GetSetting(c.DB, "b2_key_id"); v != "" {
		c.B2KeyID = v
	}
	if v, _ := db.GetSetting(c.DB, "b2_app_key"); v != "" {
		c.B2AppKey = v
	}
	if v, _ := db.GetSetting(c.DB, "b2_bucket_name"); v != "" {
		c.B2BucketName = v
	}
	if v, _ := db.GetSetting(c.DB, "b2_endpoint"); v != "" {
		c.B2Endpoint = v
	}
	if v, _ := db.GetSetting(c.DB, "default_download_mbps"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.DefaultDownloadMbps = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "default_upload_mbps"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.DefaultUploadMbps = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "download_concurrency"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.DownloadConcurrency = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "upload_concurrency"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.UploadConcurrency = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "upload_chunk_size_mb"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.UploadChunkSizeMB = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "throttle_threshold_pct"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.ThrottleThresholdPct = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "throttle_window_min"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			c.ThrottleWindowMin = n
		}
	}
	if v, _ := db.GetSetting(c.DB, "download_servers"); v != "" {
		var servers []string
		if json.Unmarshal([]byte(v), &servers) == nil && len(servers) > 0 {
			// If the saved list is the old default (22 servers), upgrade to the new defaults.
			if len(servers) == 22 && servers[0] == "http://speed.hetzner.de/10GB.bin" {
				c.DownloadServers = DefaultDownloadServers
			} else {
				c.DownloadServers = servers
			}
		}
	}
	if v, _ := db.GetSetting(c.DB, "upload_mode"); v != "" {
		c.UploadMode = v
	}
	if v, _ := db.GetSetting(c.DB, "upload_endpoints"); v != "" {
		var endpoints []string
		if json.Unmarshal([]byte(v), &endpoints) == nil && len(endpoints) > 0 {
			c.UploadEndpoints = endpoints
		}
	}
	if v, _ := db.GetSetting(c.DB, "auto_mode"); v != "" {
		c.AutoMode = v
	}
	if v, _ := db.GetSetting(c.DB, "measured_download_mbps"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			c.MeasuredDownloadMbps = f
		}
	}
	if v, _ := db.GetSetting(c.DB, "measured_upload_mbps"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			c.MeasuredUploadMbps = f
		}
	}
	if v, _ := db.GetSetting(c.DB, "last_speed_test_time"); v != "" {
		c.LastSpeedTestTime = v
	}
}

func (c *Config) Save() error {
	return c.saveSnapshot(c.Get())
}

func (c *Config) saveSnapshot(s Snapshot) error {
	if c.DB == nil {
		return nil
	}
	pairs := map[string]string{
		"b2_key_id":              s.B2KeyID,
		"b2_app_key":             s.B2AppKey,
		"b2_bucket_name":         s.B2BucketName,
		"b2_endpoint":            s.B2Endpoint,
		"default_download_mbps":  strconv.Itoa(s.DefaultDownloadMbps),
		"default_upload_mbps":    strconv.Itoa(s.DefaultUploadMbps),
		"download_concurrency":   strconv.Itoa(s.DownloadConcurrency),
		"upload_concurrency":     strconv.Itoa(s.UploadConcurrency),
		"upload_chunk_size_mb":   strconv.Itoa(s.UploadChunkSizeMB),
		"throttle_threshold_pct": strconv.Itoa(s.ThrottleThresholdPct),
		"throttle_window_min":    strconv.Itoa(s.ThrottleWindowMin),
		"upload_mode":            s.UploadMode,
		"auto_mode":              s.AutoMode,
		"measured_download_mbps": fmt.Sprintf("%.1f", s.MeasuredDownloadMbps),
		"measured_upload_mbps":   fmt.Sprintf("%.1f", s.MeasuredUploadMbps),
		"last_speed_test_time":   s.LastSpeedTestTime,
	}
	serversJSON, _ := json.Marshal(s.DownloadServers)
	pairs["download_servers"] = string(serversJSON)
	uploadEndpointsJSON, _ := json.Marshal(s.UploadEndpoints)
	pairs["upload_endpoints"] = string(uploadEndpointsJSON)

	for k, v := range pairs {
		if err := db.SetSetting(c.DB, k, v); err != nil {
			return err
		}
	}
	return nil
}

func (c *Config) SetB2Credentials(keyID, appKey, bucket, endpoint string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.B2KeyID = keyID
	c.B2AppKey = appKey
	c.B2BucketName = bucket
	if endpoint != "" {
		c.B2Endpoint = endpoint
	}
}

func (c *Config) SetSpeedTargets(dlMbps, ulMbps int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.DefaultDownloadMbps = dlMbps
	c.DefaultUploadMbps = ulMbps
}

func (c *Config) Update(mutator func(*Snapshot) error) error {
	c.mu.Lock()
	snapshot := c.snapshotLocked()
	if err := mutator(&snapshot); err != nil {
		c.mu.Unlock()
		return err
	}
	snapshot = cleanedSnapshot(snapshot)
	c.Snapshot = snapshot
	c.mu.Unlock()
	return c.saveSnapshot(snapshot)
}

func (c *Config) Get() Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.snapshotLocked()
}

func (c *Config) IsSetupRequired() bool {
	return false
}

func (c *Config) snapshotLocked() Snapshot {
	return cleanedSnapshot(c.Snapshot)
}

func (c *Config) sanitizeLocked() {
	c.Snapshot = cleanedSnapshot(c.Snapshot)

	if c.WebPort <= 0 {
		c.WebPort = DefaultWebPort
	}
	if c.DefaultDownloadMbps < 1 {
		c.DefaultDownloadMbps = DefaultDownloadMbps
	}
	if c.DefaultUploadMbps < 1 {
		c.DefaultUploadMbps = DefaultUploadMbps
	}
	if c.DownloadConcurrency < 1 {
		c.DownloadConcurrency = DefaultDownloadConcurrency
	}
	if c.UploadConcurrency < 1 {
		c.UploadConcurrency = DefaultUploadConcurrency
	}
	if c.UploadChunkSizeMB < 1 {
		c.UploadChunkSizeMB = DefaultUploadChunkSizeMB
	}
	if c.ThrottleThresholdPct < 1 || c.ThrottleThresholdPct > 100 {
		c.ThrottleThresholdPct = DefaultThrottleThreshold
	}
	if c.ThrottleWindowMin < 1 {
		c.ThrottleWindowMin = DefaultThrottleWindowMin
	}
	if !isValidUploadMode(c.UploadMode) {
		c.UploadMode = UploadModeHTTP
	}
	if !isValidAutoMode(c.AutoMode) {
		c.AutoMode = AutoModeReliable
	}
	if len(c.DownloadServers) == 0 {
		c.DownloadServers = cloneStrings(DefaultDownloadServers)
	}
	if len(c.UploadEndpoints) == 0 {
		c.UploadEndpoints = cloneStrings(DefaultUploadEndpoints)
	}
}

func cleanedSnapshot(s Snapshot) Snapshot {
	s.B2KeyID = strings.TrimSpace(s.B2KeyID)
	s.B2AppKey = strings.TrimSpace(s.B2AppKey)
	s.B2BucketName = strings.TrimSpace(s.B2BucketName)
	s.B2Endpoint = strings.TrimSpace(s.B2Endpoint)
	if s.B2Endpoint == "" {
		s.B2Endpoint = DefaultB2Endpoint
	}
	s.DownloadServers = cleanStringList(s.DownloadServers)
	s.UploadEndpoints = cleanStringList(s.UploadEndpoints)
	return s
}

func cleanStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	cleaned := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		cleaned = append(cleaned, value)
	}
	return cleaned
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func isValidUploadMode(mode string) bool {
	switch mode {
	case UploadModeS3, UploadModeHTTP, UploadModeLocal:
		return true
	default:
		return false
	}
}

func isValidAutoMode(mode string) bool {
	switch mode {
	case AutoModeReliable, AutoModeMax:
		return true
	default:
		return false
	}
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}
