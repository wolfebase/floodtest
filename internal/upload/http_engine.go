package upload

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"
)

// HTTPEngine uploads random data via HTTP POST to discard endpoints.
// Unlike the B2 engine, this does not require cloud storage credentials —
// the target servers simply accept and discard the data.
type HTTPEngine struct {
	serverList     *UploadServerList
	stats          StatsCollector
	concurrency    int
	maxConcurrency int
	chunkSize      int64
	rateLimitBps   atomic.Int64
	targetBps      atomic.Int64
	activeStreams  atomic.Int32
	running        atomic.Bool
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	mu             sync.Mutex
	statsProvider  func() int64
	client         *http.Client
	eventBuf       interface{ Add(kind, message string) }
}

// NewHTTPEngine creates an HTTPEngine. Call Start to begin uploading.
func NewHTTPEngine(serverList *UploadServerList, concurrency int, chunkSize int64, rateLimitBps int64) *HTTPEngine {
	e := &HTTPEngine{
		serverList:     serverList,
		concurrency:    concurrency,
		maxConcurrency: 64,
		chunkSize:      chunkSize,
	}
	e.rateLimitBps.Store(rateLimitBps)
	return e
}

// SetEventBuffer attaches an event buffer for emitting engine lifecycle events.
func (e *HTTPEngine) SetEventBuffer(buf interface{ Add(kind, message string) }) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.eventBuf = buf
}

// SetStatsCollector assigns the collector that receives upload byte counts.
func (e *HTTPEngine) SetStatsCollector(c StatsCollector) {
	e.stats = c
}

// SetStatsProvider sets a function returning current upload bps for auto-adjust.
func (e *HTTPEngine) SetStatsProvider(fn func() int64) {
	e.mu.Lock()
	e.statsProvider = fn
	e.mu.Unlock()
}

// SetTargetBps sets the target throughput in bits/sec for auto-adjustment.
func (e *HTTPEngine) SetTargetBps(bps int64) {
	e.targetBps.Store(bps)
}

// ActiveStreams returns the current number of running upload goroutines.
func (e *HTTPEngine) ActiveStreams() int {
	return int(e.activeStreams.Load())
}

// SetRateLimit changes the aggregate rate limit (bytes/sec). 0 = unlimited.
func (e *HTTPEngine) SetRateLimit(bps int64) {
	e.rateLimitBps.Store(bps)
}

// IsRunning reports whether the engine is currently active.
func (e *HTTPEngine) IsRunning() bool {
	return e.running.Load()
}

// SetConcurrency stores a new concurrency value that takes effect on the next Start.
func (e *HTTPEngine) SetConcurrency(n int) {
	e.mu.Lock()
	e.concurrency = n
	e.mu.Unlock()
}

// SetChunkSize updates the upload chunk size in bytes. Takes effect on next upload iteration.
func (e *HTTPEngine) SetChunkSize(bytes int64) {
	e.mu.Lock()
	e.chunkSize = bytes
	e.mu.Unlock()
}

// Start launches upload goroutines and the auto-adjust goroutine.
func (e *HTTPEngine) Start(ctx context.Context) error {
	childCtx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.running.Store(true)
	e.client = e.httpClient()

	e.activeStreams.Store(0)
	for i := 0; i < e.concurrency; i++ {
		e.launchStream(childCtx)
	}

	// Auto-adjust goroutine.
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		e.autoAdjust(childCtx)
	}()

	return nil
}

// Stop cancels all upload goroutines and waits for them to finish.
func (e *HTTPEngine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
	e.wg.Wait()
	e.running.Store(false)
	e.activeStreams.Store(0)
}

func (e *HTTPEngine) launchStream(ctx context.Context) {
	e.wg.Add(1)
	e.activeStreams.Add(1)
	go func() {
		defer e.wg.Done()
		defer e.activeStreams.Add(-1)
		e.uploadLoop(ctx)
	}()
}

// uploadLoop repeatedly selects a server and uploads random data until cancelled.
func (e *HTTPEngine) uploadLoop(ctx context.Context) {
	buf := make([]byte, 256*1024)
	rand.Read(buf) // fill once with random data

	for {
		if ctx.Err() != nil {
			return
		}

		serverURL := e.serverList.Next()
		if serverURL == "" {
			log.Printf("upload(http): no servers configured, waiting 5s")
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		e.serverList.IncrementStreams(serverURL)
		err := e.uploadTo(ctx, e.client, serverURL, buf)
		e.serverList.DecrementStreams(serverURL)

		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("upload(http): error uploading to %s: %v", serverURL, err)
			e.serverList.MarkUnhealthy(serverURL, err.Error())
			select {
			case <-ctx.Done():
				return
			case <-time.After(1 * time.Second):
			}
			continue
		}

		e.serverList.MarkSuccess(serverURL)
	}
}

// uploadTo performs a single HTTP POST of random data to the given server URL.
// buf must be a pre-filled random data buffer (reused across calls to avoid crypto/rand overhead).
func (e *HTTPEngine) uploadTo(ctx context.Context, client *http.Client, serverURL string, buf []byte) error {
	pr, pw := io.Pipe()

	// Determine per-stream rate limit.
	totalBps := e.rateLimitBps.Load()
	e.mu.Lock()
	conc := e.concurrency
	chunkSize := e.chunkSize
	e.mu.Unlock()

	var limiter *rate.Limiter
	if totalBps > 0 && conc > 0 {
		perStream := totalBps / int64(conc)
		if perStream < 1 {
			perStream = 1
		}
		burst := int(perStream)
		if burst > 256*1024 {
			burst = 256 * 1024
		}
		limiter = rate.NewLimiter(rate.Limit(perStream), burst)
	}

	// Writer goroutine: push pre-filled random data into the pipe.
	go func() {
		defer pw.Close()
		var written int64
		for written < chunkSize {
			if ctx.Err() != nil {
				return
			}

			toWrite := int64(len(buf))
			if remaining := chunkSize - written; remaining < toWrite {
				toWrite = remaining
			}

			n := int(toWrite) // buf is already filled with random data

			if limiter != nil {
				if err := limiter.WaitN(ctx, n); err != nil {
					return
				}
			}

			nn, err := pw.Write(buf[:n])
			if err != nil {
				return
			}
			written += int64(nn)
		}
	}()

	// Wrap the pipe reader to count bytes as they are consumed.
	reader := &httpCountingReader{
		r:          pr,
		stats:      e.stats,
		serverList: e.serverList,
		serverURL:  serverURL,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, serverURL, reader)
	if err != nil {
		pr.CloseWithError(err)
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = chunkSize

	resp, err := client.Do(req)
	if err != nil {
		pr.CloseWithError(err)
		return fmt.Errorf("POST %s: %w", serverURL, err)
	}
	defer resp.Body.Close()
	// Drain body so connection can be reused.
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("POST %s: status %d", serverURL, resp.StatusCode)
	}

	return nil
}

// httpCountingReader wraps an io.Reader and reports bytes read to both
// the StatsCollector and the per-server upload bytes tracker.
type httpCountingReader struct {
	r          io.Reader
	stats      StatsCollector
	serverList *UploadServerList
	serverURL  string
}

func (cr *httpCountingReader) Read(p []byte) (int, error) {
	n, err := cr.r.Read(p)
	if n > 0 {
		if cr.stats != nil {
			cr.stats.AddUploadBytes(int64(n))
		}
		cr.serverList.AddBytes(cr.serverURL, int64(n))
	}
	return n, err
}

// httpClient returns an *http.Client configured for upload streaming.
func (e *HTTPEngine) httpClient() *http.Client {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: 30 * time.Second,
		MaxIdleConnsPerHost: 64,
	}
	return &http.Client{
		Transport: transport,
		// No overall timeout — uploads can be large.
	}
}

// autoAdjust monitors throughput and adds streams if below target.
func (e *HTTPEngine) autoAdjust(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.mu.Lock()
			provider := e.statsProvider
			maxConc := e.maxConcurrency
			e.mu.Unlock()

			if provider == nil {
				continue
			}

			target := e.targetBps.Load()
			if target <= 0 {
				continue
			}

			current := provider()
			active := int(e.activeStreams.Load())

			if current < target*80/100 && active < maxConc {
				e.launchStream(ctx)
				log.Printf("upload(http) auto-adjust: added stream (now %d, current=%dMbps, target=%dMbps)",
					e.activeStreams.Load(), current/1_000_000, target/1_000_000)
				if eb := e.eventBuf; eb != nil {
					eb.Add("stream", fmt.Sprintf("+1 upload(http) stream → %d total", e.activeStreams.Load()))
				}
			}
		}
	}
}
