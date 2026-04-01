package updater

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"wansaturator/internal/version"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/mount"
	"github.com/docker/docker/client"
)

type UpdateStatus struct {
	CurrentVersion     string `json:"currentVersion"`
	CurrentBuildDate   string `json:"currentBuildDate"`
	LatestVersion      string `json:"latestVersion,omitempty"`
	CurrentDigest      string `json:"currentDigest"`
	LatestDigest       string `json:"latestDigest,omitempty"`
	UpdateAvailable    bool   `json:"updateAvailable"`
	LastCheckTime      string `json:"lastCheckTime,omitempty"`
	LastUpdateTime     string `json:"lastUpdateTime,omitempty"`
	AutoUpdateEnabled  bool   `json:"autoUpdateEnabled"`
	AutoUpdateSchedule string `json:"autoUpdateSchedule"`
	Checking           bool   `json:"checking"`
	Updating           bool   `json:"updating"`
	DockerAvailable    bool   `json:"dockerAvailable"`
}

type UpdateHistoryEntry struct {
	ID             int    `json:"id"`
	PreviousDigest string `json:"previousDigest"`
	NewDigest      string `json:"newDigest"`
	Status         string `json:"status"`
	ErrorMessage   string `json:"errorMessage,omitempty"`
	CreatedAt      string `json:"createdAt"`
}

type Updater struct {
	mu            sync.Mutex
	db            *sql.DB
	docker        *client.Client
	imageName     string
	containerName string
	composeDir    string

	currentDigest   string
	latestDigest    string
	latestVersion   string
	lastCheckTime   time.Time
	lastUpdateTime  time.Time
	updateAvailable bool
	checking        bool
	updating        bool

	autoEnabled  bool
	autoSchedule string

	cancel context.CancelFunc
}

func New(db *sql.DB) *Updater {
	u := &Updater{
		db:            db,
		imageName:     "ghcr.io/twolfekc/floodtest",
		containerName: "floodtest",
		composeDir:    os.Getenv("COMPOSE_DIR"),
	}
	if u.composeDir == "" {
		u.composeDir = "/opt/floodtest"
	}

	docker, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		log.Printf("updater: Docker not available: %v", err)
		return u
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := docker.Ping(ctx); err != nil {
		log.Printf("updater: Docker socket not accessible: %v", err)
		return u
	}
	u.docker = docker
	u.currentDigest = u.getCurrentDigest()
	u.loadSettings()
	log.Printf("updater: initialized (digest: %s)", u.short(u.currentDigest))
	return u
}

func (u *Updater) Start(ctx context.Context) {
	ctx, u.cancel = context.WithCancel(ctx)
	go u.autoUpdateLoop(ctx)
}

func (u *Updater) Stop() {
	if u.cancel != nil {
		u.cancel()
	}
}

func (u *Updater) IsDockerAvailable() bool {
	return u.docker != nil
}

func (u *Updater) GetStatus() *UpdateStatus {
	u.mu.Lock()
	defer u.mu.Unlock()
	s := &UpdateStatus{
		CurrentVersion:     version.Version,
		CurrentBuildDate:   version.BuildDate,
		LatestVersion:      u.latestVersion,
		CurrentDigest:      u.short(u.currentDigest),
		LatestDigest:       u.short(u.latestDigest),
		UpdateAvailable:    u.updateAvailable,
		AutoUpdateEnabled:  u.autoEnabled,
		AutoUpdateSchedule: u.autoSchedule,
		Checking:           u.checking,
		Updating:           u.updating,
		DockerAvailable:    u.docker != nil,
	}
	if !u.lastCheckTime.IsZero() {
		s.LastCheckTime = u.lastCheckTime.UTC().Format(time.RFC3339)
	}
	if !u.lastUpdateTime.IsZero() {
		s.LastUpdateTime = u.lastUpdateTime.UTC().Format(time.RFC3339)
	}
	return s
}

func (u *Updater) CheckForUpdate(ctx context.Context) (*UpdateStatus, error) {
	u.mu.Lock()
	u.checking = true
	u.mu.Unlock()
	defer func() {
		u.mu.Lock()
		u.checking = false
		u.mu.Unlock()
	}()

	digest, latestVer, err := u.fetchLatestDigest(ctx)
	if err != nil {
		return nil, fmt.Errorf("check update: %w", err)
	}

	u.mu.Lock()
	u.latestDigest = digest
	u.latestVersion = latestVer
	u.lastCheckTime = time.Now()
	u.updateAvailable = digest != "" && digest != u.currentDigest
	u.mu.Unlock()

	return u.GetStatus(), nil
}

func (u *Updater) ApplyUpdate(ctx context.Context) error {
	if u.docker == nil {
		return fmt.Errorf("Docker not available")
	}

	u.mu.Lock()
	if u.updating {
		u.mu.Unlock()
		return fmt.Errorf("update already in progress")
	}
	u.updating = true
	prev := u.currentDigest
	u.mu.Unlock()
	defer func() {
		u.mu.Lock()
		u.updating = false
		u.mu.Unlock()
	}()

	log.Println("updater: pulling latest image...")
	reader, err := u.docker.ImagePull(ctx, u.imageName+":latest", image.PullOptions{})
	if err != nil {
		u.record(prev, "", "failed", err.Error())
		return fmt.Errorf("pull image: %w", err)
	}
	io.Copy(io.Discard, reader)
	reader.Close()

	log.Println("updater: launching updater container...")

	script := fmt.Sprintf(`#!/bin/sh
set -e
echo "FloodTest updater: waiting..."
sleep 3
cd %s
docker compose pull
docker compose up -d --force-recreate
echo "FloodTest updater: done"
docker rm -f floodtest-updater 2>/dev/null || true
`, u.composeDir)

	if err := os.WriteFile("/data/.floodtest-update.sh", []byte(script), 0755); err != nil {
		u.record(prev, "", "failed", err.Error())
		return fmt.Errorf("write script: %w", err)
	}

	volName := u.dataVolumeName(ctx)

	// Remove stale updater container if exists
	u.docker.ContainerRemove(ctx, "floodtest-updater", container.RemoveOptions{Force: true})

	// Find or pull a helper image that has docker CLI.
	// Try multiple variants in case one isn't available.
	helperImage := u.ensureHelperImage(ctx)
	if helperImage == "" {
		u.record(prev, "", "failed", "no suitable helper image found")
		return fmt.Errorf("update failed: could not pull a Docker CLI helper image. Run manually: cd %s && docker compose pull && docker compose up -d --force-recreate", u.composeDir)
	}

	resp, err := u.docker.ContainerCreate(ctx, &container.Config{
		Image: helperImage,
		Cmd:   []string{"sh", "/data/.floodtest-update.sh"},
	}, &container.HostConfig{
		Mounts: []mount.Mount{
			{Type: mount.TypeBind, Source: "/var/run/docker.sock", Target: "/var/run/docker.sock"},
			{Type: mount.TypeVolume, Source: volName, Target: "/data"},
			{Type: mount.TypeBind, Source: u.composeDir, Target: u.composeDir},
		},
	}, nil, nil, "floodtest-updater")
	if err != nil {
		u.record(prev, "", "failed", err.Error())
		return fmt.Errorf("create updater: %w", err)
	}

	if err := u.docker.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		u.record(prev, "", "failed", err.Error())
		return fmt.Errorf("start updater: %w", err)
	}

	u.record(prev, u.latestDigest, "success", "")
	u.mu.Lock()
	u.lastUpdateTime = time.Now()
	u.mu.Unlock()

	log.Println("updater: helper launched, container will restart shortly")
	return nil
}

func (u *Updater) SetAutoUpdate(enabled bool, schedule string) error {
	u.mu.Lock()
	u.autoEnabled = enabled
	u.autoSchedule = schedule
	u.mu.Unlock()
	if u.db != nil {
		u.db.Exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			"auto_update_enabled", fmt.Sprintf("%v", enabled))
		u.db.Exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			"auto_update_schedule", schedule)
	}
	return nil
}

func (u *Updater) GetHistory() []UpdateHistoryEntry {
	if u.db == nil {
		return []UpdateHistoryEntry{}
	}
	rows, err := u.db.Query("SELECT id, previous_digest, new_digest, status, COALESCE(error_message,''), created_at FROM update_history ORDER BY id DESC LIMIT 20")
	if err != nil {
		return []UpdateHistoryEntry{}
	}
	defer rows.Close()
	var entries []UpdateHistoryEntry
	for rows.Next() {
		var e UpdateHistoryEntry
		rows.Scan(&e.ID, &e.PreviousDigest, &e.NewDigest, &e.Status, &e.ErrorMessage, &e.CreatedAt)
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []UpdateHistoryEntry{}
	}
	return entries
}

// --- internal helpers ---

// ensureHelperImage tries to find or pull a Docker image that contains
// the docker CLI (needed to run docker compose). It tries multiple image
// names in order, first checking if any are already available locally,
// then pulling. Returns the image name or empty string if all fail.
func (u *Updater) ensureHelperImage(ctx context.Context) string {
	candidates := []string{"docker:cli", "docker:27-cli", "docker:latest"}

	// First check if any candidate is already available locally.
	for _, img := range candidates {
		_, _, err := u.docker.ImageInspectWithRaw(ctx, img)
		if err == nil {
			log.Printf("updater: using existing helper image %s", img)
			return img
		}
	}

	// None available locally — try pulling each one.
	for _, img := range candidates {
		log.Printf("updater: pulling helper image %s...", img)
		reader, err := u.docker.ImagePull(ctx, img, image.PullOptions{})
		if err != nil {
			log.Printf("updater: failed to pull %s: %v", img, err)
			continue
		}
		io.Copy(io.Discard, reader)
		reader.Close()
		log.Printf("updater: pulled helper image %s", img)
		return img
	}

	log.Println("updater: could not find or pull any Docker CLI helper image")
	return ""
}

func (u *Updater) getCurrentDigest() string {
	if u.docker == nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	inspect, err := u.docker.ContainerInspect(ctx, u.containerName)
	if err != nil {
		return ""
	}
	return inspect.Image
}

func (u *Updater) fetchLatestDigest(ctx context.Context) (string, string, error) {
	tokenURL := "https://ghcr.io/token?scope=repository:twolfekc/floodtest:pull"
	req, _ := http.NewRequestWithContext(ctx, "GET", tokenURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	var tok struct {
		Token string `json:"token"`
	}
	json.NewDecoder(resp.Body).Decode(&tok)

	// GET (not HEAD) the manifest so we can read annotations/labels for version.
	mURL := "https://ghcr.io/v2/twolfekc/floodtest/manifests/latest"
	req, _ = http.NewRequestWithContext(ctx, "GET", mURL, nil)
	req.Header.Set("Authorization", "Bearer "+tok.Token)
	req.Header.Set("Accept", "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json")

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	digest := resp.Header.Get("Docker-Content-Digest")
	if digest == "" {
		return "", "", fmt.Errorf("no digest in response")
	}

	// Try to extract version from OCI annotations in the manifest.
	var latestVer string
	var manifest struct {
		Annotations map[string]string `json:"annotations"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err == nil {
		if v, ok := manifest.Annotations["org.opencontainers.image.version"]; ok {
			latestVer = v
		}
	}

	return digest, latestVer, nil
}

func (u *Updater) dataVolumeName(ctx context.Context) string {
	if u.docker == nil {
		return "floodtest-data"
	}
	inspect, err := u.docker.ContainerInspect(ctx, u.containerName)
	if err != nil {
		return "floodtest-data"
	}
	for _, m := range inspect.Mounts {
		if m.Destination == "/data" && m.Type == mount.TypeVolume {
			return m.Name
		}
	}
	return "floodtest-data"
}

func (u *Updater) short(digest string) string {
	if len(digest) > 19 {
		return digest[:19]
	}
	return digest
}

func (u *Updater) record(prev, next, status, errMsg string) {
	if u.db == nil {
		return
	}
	u.db.Exec("INSERT INTO update_history (previous_digest, new_digest, status, error_message) VALUES (?, ?, ?, ?)",
		u.short(prev), u.short(next), status, errMsg)
}

func (u *Updater) loadSettings() {
	if u.db == nil {
		return
	}
	var val string
	if u.db.QueryRow("SELECT value FROM settings WHERE key = 'auto_update_enabled'").Scan(&val) == nil {
		u.autoEnabled = val == "true"
	}
	if u.db.QueryRow("SELECT value FROM settings WHERE key = 'auto_update_schedule'").Scan(&val) == nil {
		u.autoSchedule = val
	}
}

func (u *Updater) autoUpdateLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			u.mu.Lock()
			enabled := u.autoEnabled
			schedule := u.autoSchedule
			u.mu.Unlock()
			if !enabled || u.docker == nil {
				continue
			}
			if !u.shouldRun(schedule) {
				continue
			}
			log.Println("updater: auto-update check triggered")
			status, err := u.CheckForUpdate(ctx)
			if err != nil {
				log.Printf("updater: auto-check failed: %v", err)
				continue
			}
			if status.UpdateAvailable {
				log.Println("updater: applying auto-update...")
				if err := u.ApplyUpdate(ctx); err != nil {
					log.Printf("updater: auto-apply failed: %v", err)
				}
			}
		}
	}
}

func (u *Updater) shouldRun(schedule string) bool {
	now := time.Now()
	switch schedule {
	case "daily":
		return now.Hour() == 3
	case "weekly":
		return now.Weekday() == time.Sunday && now.Hour() == 3
	case "monthly":
		return now.Day() == 1 && now.Hour() == 3
	}
	return false
}
