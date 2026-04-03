package speedtest

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// Cloudflare rate-limits large single requests (403 for 100MB+).
	// Use 25MB chunks — each goroutine loops and re-requests, keeping the
	// connection busy for the full test window without triggering the limit.
	downloadURL     = "https://speed.cloudflare.com/__down?bytes=25000000" // 25MB per request
	uploadURL       = "https://speed.cloudflare.com/__up"
	streams         = 16
	warmupDuration  = 3 * time.Second
	testDuration    = 10 * time.Second
	sampleInterval  = 200 * time.Millisecond
	uploadChunkSize = 10 * 1024 * 1024 // 10MB per POST
	trimPercent     = 0.25             // trim top/bottom 25%
)

// Result holds the outcome of an ISP speed test.
type Result struct {
	DownloadMbps float64   `json:"downloadMbps"`
	UploadMbps   float64   `json:"uploadMbps"`
	Timestamp    time.Time `json:"timestamp"`
	Streams      int       `json:"streams"`
}

// ProgressCallback is called during the test to report phase and completion percentage.
type ProgressCallback func(phase string, pct int)

// RunISPTest performs a multi-stream ISP speed test using Cloudflare endpoints.
// It measures download and upload throughput with warm-up discard and trimmed mean.
func RunISPTest(ctx context.Context, onProgress ProgressCallback) (*Result, error) {
	if onProgress == nil {
		onProgress = func(string, int) {}
	}

	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 10 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
		MaxIdleConnsPerHost: streams * 2,
	}
	client := &http.Client{Transport: transport}

	dlMbps, err := measureDownload(ctx, client, onProgress)
	if err != nil {
		return nil, fmt.Errorf("download test failed: %w", err)
	}

	ulMbps, err := measureUpload(ctx, client, onProgress)
	if err != nil {
		return nil, fmt.Errorf("upload test failed: %w", err)
	}

	result := &Result{
		DownloadMbps: dlMbps,
		UploadMbps:   ulMbps,
		Timestamp:    time.Now(),
		Streams:      streams,
	}
	log.Printf("[speedtest] ISP test complete: download=%.1f Mbps, upload=%.1f Mbps (%d streams)",
		result.DownloadMbps, result.UploadMbps, result.Streams)
	return result, nil
}

// measureDownload runs multi-stream downloads against Cloudflare and returns the trimmed mean Mbps.
func measureDownload(ctx context.Context, client *http.Client, onProgress ProgressCallback) (float64, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var totalBytes atomic.Int64
	var wg sync.WaitGroup

	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, 256*1024)
			for {
				if ctx.Err() != nil {
					return
				}
				req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
				if err != nil {
					return
				}
				req.Header.Set("Accept-Encoding", "identity")

				resp, err := client.Do(req)
				if err != nil {
					if ctx.Err() != nil {
						return
					}
					continue
				}
				if resp.StatusCode != http.StatusOK {
					resp.Body.Close()
					log.Printf("[speedtest] download got HTTP %d, retrying", resp.StatusCode)
					time.Sleep(100 * time.Millisecond)
					continue
				}
				for {
					n, readErr := resp.Body.Read(buf)
					if n > 0 {
						totalBytes.Add(int64(n))
					}
					if readErr != nil {
						break
					}
				}
				resp.Body.Close()
			}
		}()
	}

	samples := collectSamples(ctx, &totalBytes, onProgress, "download")
	cancel()
	wg.Wait()

	if len(samples) == 0 {
		return 0, fmt.Errorf("no samples collected during download test")
	}
	return trimmedMeanMbps(samples), nil
}

// measureUpload runs multi-stream uploads against Cloudflare and returns the trimmed mean Mbps.
func measureUpload(ctx context.Context, client *http.Client, onProgress ProgressCallback) (float64, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Pre-fill a reusable random buffer.
	uploadBuf := make([]byte, uploadChunkSize)
	if _, err := rand.Read(uploadBuf); err != nil {
		return 0, fmt.Errorf("generating random upload data: %w", err)
	}

	var totalBytes atomic.Int64
	var wg sync.WaitGroup

	for i := 0; i < streams; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				if ctx.Err() != nil {
					return
				}
				cr := &countingReader{
					data:  uploadBuf,
					total: &totalBytes,
				}
				req, err := http.NewRequestWithContext(ctx, http.MethodPost, uploadURL, cr)
				if err != nil {
					return
				}
				req.Header.Set("Content-Type", "application/octet-stream")
				req.ContentLength = int64(uploadChunkSize)

				resp, err := client.Do(req)
				if err != nil {
					if ctx.Err() != nil {
						return
					}
					continue
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
			}
		}()
	}

	samples := collectSamples(ctx, &totalBytes, onProgress, "upload")
	cancel()
	wg.Wait()

	if len(samples) == 0 {
		return 0, fmt.Errorf("no samples collected during upload test")
	}
	return trimmedMeanMbps(samples), nil
}

// collectSamples gathers throughput samples at 200ms intervals, skipping the warm-up period.
func collectSamples(ctx context.Context, totalBytes *atomic.Int64, onProgress ProgressCallback, phase string) []float64 {
	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	totalDuration := warmupDuration + testDuration
	start := time.Now()
	lastBytes := totalBytes.Load()
	var samples []float64

	for {
		select {
		case <-ctx.Done():
			return samples
		case <-ticker.C:
			elapsed := time.Since(start)
			if elapsed >= totalDuration {
				return samples
			}

			currentBytes := totalBytes.Load()
			delta := float64(currentBytes - lastBytes)
			lastBytes = currentBytes

			if elapsed >= warmupDuration {
				samples = append(samples, delta)

				testElapsed := elapsed - warmupDuration
				pct := int(testElapsed * 100 / testDuration)
				if pct > 100 {
					pct = 100
				}
				onProgress(phase, pct)
			}
		}
	}
}

// trimmedMeanMbps computes a trimmed mean from throughput samples (bytes per 200ms interval),
// discarding the top and bottom 25%, then converts to Mbps.
func trimmedMeanMbps(samples []float64) float64 {
	if len(samples) == 0 {
		return 0
	}

	sorted := make([]float64, len(samples))
	copy(sorted, samples)
	sort.Float64s(sorted)

	n := len(sorted)
	trimCount := int(float64(n) * trimPercent)
	trimmed := sorted[trimCount : n-trimCount]

	if len(trimmed) == 0 {
		// Not enough samples to trim; use all.
		trimmed = sorted
	}

	var sum float64
	for _, v := range trimmed {
		sum += v
	}
	avgBytesPerInterval := sum / float64(len(trimmed))

	// Convert: bytes per 200ms → bits per second → megabits per second
	return avgBytesPerInterval * 8 / 0.2 / 1_000_000
}

// SaveResult persists an ISP speed test result to the speedtest_history table.
func SaveResult(db *sql.DB, r Result) error {
	_, err := db.Exec(
		`INSERT INTO speedtest_history (timestamp, download_mbps, upload_mbps, streams) VALUES (?, ?, ?, ?)`,
		r.Timestamp.UTC().Format(time.RFC3339), r.DownloadMbps, r.UploadMbps, r.Streams,
	)
	return err
}

// countingReader reads from a pre-filled byte slice while tracking total bytes read via an atomic counter.
type countingReader struct {
	data   []byte
	offset int
	total  *atomic.Int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	if r.offset >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.offset:])
	r.offset += n
	r.total.Add(int64(n))
	return n, nil
}
