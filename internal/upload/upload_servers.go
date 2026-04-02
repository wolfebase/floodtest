package upload

import (
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	uploadUnhealthyCooldown   = 30 * time.Second
	uploadMaxCooldown         = 10 * time.Minute
	uploadSpeedSampleWindow   = 5
)

// UploadServerHealth contains the current health status of an upload server,
// exported for API consumption.
type UploadServerHealth struct {
	URL                 string    `json:"url"`
	Healthy             bool      `json:"healthy"`
	Blocked             bool      `json:"blocked"`
	ConsecutiveFailures int       `json:"consecutiveFailures"`
	TotalFailures       int       `json:"totalFailures"`
	TotalUploads        int       `json:"totalUploads"`
	LastError           string    `json:"lastError,omitempty"`
	LastErrorTime       time.Time `json:"lastErrorTime,omitempty"`
	UnhealthyUntil      time.Time `json:"unhealthyUntil,omitempty"`
	BytesUploaded       int64     `json:"bytesUploaded"`
	ActiveStreams       int32     `json:"activeStreams"`
	SpeedBps            float64   `json:"speedBps"`
	Status              string    `json:"status"`
	Location            string    `json:"location"`
}

// uploadServer represents a single upload endpoint with health tracking.
type uploadServer struct {
	url                 string
	location            string
	healthy             bool
	blocked             bool
	unhealthyUntil      time.Time
	consecutiveFailures int
	totalFailures       int
	totalUploads        int
	lastError           string
	lastErrorTime       time.Time
	bytesUploaded       int64
	activeStreams       int32
	speedScore          float64
	speedSamples        []float64
}

// UploadServerList manages a thread-safe list of upload servers
// with per-server health tracking and round-robin selection.
type UploadServerList struct {
	mu      sync.RWMutex
	servers []uploadServer
	index   int
}

// deriveUploadLocation extracts a human-readable region label from a server URL's hostname.
// Returns an empty string if the hostname doesn't match any known region pattern.
func deriveUploadLocation(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	host := strings.ToLower(u.Hostname())

	regionMap := map[string]string{
		"us-west":    "US West",
		"us-east":    "US East",
		"eu-central": "EU Central",
		"eu-west":    "EU West",
		"ap-south":   "AP South",
		"ap-north":   "AP Northeast",
	}
	for pattern, label := range regionMap {
		if strings.Contains(host, pattern) {
			return label
		}
	}
	return ""
}

// NewUploadServerList creates an UploadServerList from the given URLs.
// All servers start in the healthy state.
func NewUploadServerList(urls []string) *UploadServerList {
	servers := make([]uploadServer, len(urls))
	for i, u := range urls {
		servers[i] = uploadServer{url: u, location: deriveUploadLocation(u), healthy: true}
	}
	return &UploadServerList{servers: servers}
}

// Next returns the URL of the next healthy server using round-robin selection.
//
// Selection strategy:
//  1. Promote any servers whose cooldown has expired.
//  2. Round-robin among healthy servers.
//  3. If all servers are unhealthy, return the one whose cooldown expires soonest.
func (sl *UploadServerList) Next() string {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	if len(sl.servers) == 0 {
		return ""
	}

	now := time.Now()

	// Phase 1: promote servers whose cooldown expired (skip blocked).
	for i := range sl.servers {
		s := &sl.servers[i]
		if !s.healthy && !s.blocked && now.After(s.unhealthyUntil) {
			s.healthy = true
			s.unhealthyUntil = time.Time{}
			s.consecutiveFailures = 0
		}
	}

	// Phase 2: round-robin among healthy, non-blocked servers.
	start := sl.index
	for i := 0; i < len(sl.servers); i++ {
		idx := (start + i) % len(sl.servers)
		s := &sl.servers[idx]
		if s.healthy && !s.blocked {
			sl.index = (idx + 1) % len(sl.servers)
			return s.url
		}
	}

	// Phase 3: all unhealthy — pick the non-blocked one with soonest recovery.
	var bestIdx int
	var bestTime time.Time
	first := true
	for i := range sl.servers {
		s := &sl.servers[i]
		if !s.blocked && (first || s.unhealthyUntil.Before(bestTime)) {
			bestIdx = i
			bestTime = s.unhealthyUntil
			first = false
		}
	}
	// If all servers are blocked, fall back to first server
	if first {
		bestIdx = 0
	}
	sl.index = (bestIdx + 1) % len(sl.servers)
	return sl.servers[bestIdx].url
}

// MarkUnhealthy marks the server identified by url as unhealthy.
// Cooldown increases with consecutive failures: 30s * 2^(failures-1), capped at 10min.
func (sl *UploadServerList) MarkUnhealthy(url, errMsg string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			s := &sl.servers[i]
			s.healthy = false
			s.consecutiveFailures++
			s.totalFailures++
			s.lastError = errMsg
			s.lastErrorTime = time.Now()

			// Auto-block servers with 5+ consecutive failures
			if s.consecutiveFailures >= 5 {
				s.blocked = true
			}

			// Exponential backoff: 30s * 2^(failures-1), capped at 10min
			cooldown := uploadUnhealthyCooldown
			for j := 1; j < s.consecutiveFailures && cooldown < uploadMaxCooldown; j++ {
				cooldown *= 2
			}
			if cooldown > uploadMaxCooldown {
				cooldown = uploadMaxCooldown
			}
			s.unhealthyUntil = time.Now().Add(cooldown)
			return
		}
	}
}

// MarkSuccess records a successful upload completion from a server.
// Resets consecutive failures and increments the upload counter.
func (sl *UploadServerList) MarkSuccess(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].totalUploads++
			return
		}
	}
}

// AddBytes incrementally updates the bytes uploaded counter for a server.
// Called during streaming to provide real-time progress in the health UI.
func (sl *UploadServerList) AddBytes(url string, n int64) {
	sl.mu.RLock()
	defer sl.mu.RUnlock()
	for i := range sl.servers {
		if sl.servers[i].url == url {
			atomic.AddInt64(&sl.servers[i].bytesUploaded, n)
			return
		}
	}
}

// UpdateSpeedScore records a speed sample (bytes per second) for the given server.
// It maintains a rolling window of up to uploadSpeedSampleWindow samples.
func (sl *UploadServerList) UpdateSpeedScore(url string, bps float64) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			s := &sl.servers[i]
			s.speedSamples = append(s.speedSamples, bps)
			if len(s.speedSamples) > uploadSpeedSampleWindow {
				s.speedSamples = s.speedSamples[len(s.speedSamples)-uploadSpeedSampleWindow:]
			}
			var total float64
			for _, v := range s.speedSamples {
				total += v
			}
			s.speedScore = total / float64(len(s.speedSamples))
			return
		}
	}
}

// IncrementStreams atomically adds one to the active stream count for a server.
func (sl *UploadServerList) IncrementStreams(url string) {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			atomic.AddInt32(&sl.servers[i].activeStreams, 1)
			return
		}
	}
}

// DecrementStreams atomically subtracts one from the active stream count for a server.
func (sl *UploadServerList) DecrementStreams(url string) {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			atomic.AddInt32(&sl.servers[i].activeStreams, -1)
			return
		}
	}
}

// HealthStatus returns the current health of all upload servers for API/UI consumption.
func (sl *UploadServerList) HealthStatus() []UploadServerHealth {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	now := time.Now()
	result := make([]UploadServerHealth, len(sl.servers))
	for i, s := range sl.servers {
		healthy := s.healthy
		if !healthy && !s.blocked && now.After(s.unhealthyUntil) {
			healthy = true // cooldown expired
		}

		status := "healthy"
		if s.blocked {
			status = "blocked"
		} else if !s.healthy {
			if s.consecutiveFailures >= 5 {
				status = "failed"
			} else if now.Before(s.unhealthyUntil) {
				status = "cooldown"
			}
		}

		result[i] = UploadServerHealth{
			URL:                 s.url,
			Healthy:             healthy,
			Blocked:             s.blocked,
			ConsecutiveFailures: s.consecutiveFailures,
			TotalFailures:       s.totalFailures,
			TotalUploads:        s.totalUploads,
			LastError:           s.lastError,
			LastErrorTime:       s.lastErrorTime,
			UnhealthyUntil:      s.unhealthyUntil,
			BytesUploaded:       atomic.LoadInt64(&sl.servers[i].bytesUploaded),
			ActiveStreams:       atomic.LoadInt32(&sl.servers[i].activeStreams),
			SpeedBps:            s.speedScore,
			Status:              status,
			Location:            s.location,
		}
	}
	return result
}

// UpdateServers replaces the entire server list with the given URLs.
// All new servers start healthy and the round-robin index is reset.
func (sl *UploadServerList) UpdateServers(urls []string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	servers := make([]uploadServer, len(urls))
	for i, u := range urls {
		servers[i] = uploadServer{url: u, location: deriveUploadLocation(u), healthy: true}
	}
	sl.servers = servers
	sl.index = 0
}

// HealthyCount returns the number of currently healthy servers.
func (sl *UploadServerList) HealthyCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	now := time.Now()
	count := 0
	for _, s := range sl.servers {
		if !s.blocked && (s.healthy || now.After(s.unhealthyUntil)) {
			count++
		}
	}
	return count
}

// TotalCount returns the total number of configured upload servers.
func (sl *UploadServerList) TotalCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()
	return len(sl.servers)
}

// ResetCooldowns marks all servers as healthy, clearing any backoff and blocked state.
func (sl *UploadServerList) ResetCooldowns() {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		sl.servers[i].healthy = true
		sl.servers[i].blocked = false
		sl.servers[i].unhealthyUntil = time.Time{}
		sl.servers[i].consecutiveFailures = 0
	}
}

// UnblockServer removes the blocked state for a server and resets it to healthy.
func (sl *UploadServerList) UnblockServer(url string) bool {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].url == url {
			sl.servers[i].blocked = false
			sl.servers[i].healthy = true
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].unhealthyUntil = time.Time{}
			return true
		}
	}
	return false
}

// UnblockAll removes the blocked state from all blocked servers, resetting them to healthy.
func (sl *UploadServerList) UnblockAll() int {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	count := 0
	for i := range sl.servers {
		if sl.servers[i].blocked {
			sl.servers[i].blocked = false
			sl.servers[i].healthy = true
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].unhealthyUntil = time.Time{}
			count++
		}
	}
	return count
}
