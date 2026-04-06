package download

import (
	"context"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/time/rate"
)

const (
	readBufSize = 256 << 10 // 256 KB per read chunk
	burstSize   = 1 << 20   // 1 MB burst for the token-bucket limiter
	connTimeout = 30 * time.Second
	retrySleep  = 1 * time.Second
)

// StatsCollector is the interface used by the Engine to report downloaded bytes.
type StatsCollector interface {
	AddDownloadBytes(n int64)
}

// Engine drives parallel HTTP download streams to saturate WAN bandwidth.
type Engine struct {
	serverList     *ServerList
	stats          atomic.Value // holds StatsCollector (may be nil)
	concurrency    int
	maxConcurrency int
	rateLimitBps   atomic.Int64 // 0 = unlimited
	targetBps      atomic.Int64 // target throughput in bits/sec for auto-adjust
	activeStreams  atomic.Int32 // live count of running goroutines
	running        atomic.Bool
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	mu             sync.Mutex   // guards concurrency and cancel
	statsProvider  func() int64 // returns current download bps
	httpClient     *http.Client // shared across all goroutines for connection reuse
	eventBuf       interface{ Add(kind, message string) }
}

// New creates a download Engine.
//
// concurrency is the number of parallel download goroutines.
// rateLimitBps is the aggregate rate limit in bytes/sec (0 = unlimited).
func New(serverList *ServerList, concurrency int, rateLimitBps int64) *Engine {
	e := &Engine{
		serverList:     serverList,
		concurrency:    concurrency,
		maxConcurrency: 64,
		httpClient:     newHTTPClient(),
	}
	e.rateLimitBps.Store(rateLimitBps)
	return e
}

// SetEventBuffer attaches an event buffer for emitting engine lifecycle events.
func (e *Engine) SetEventBuffer(buf interface{ Add(kind, message string) }) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.eventBuf = buf
}

// SetStatsProvider sets a function that returns current download throughput in bps.
// Used by the auto-adjust goroutine to decide when to add streams.
func (e *Engine) SetStatsProvider(fn func() int64) {
	e.mu.Lock()
	e.statsProvider = fn
	e.mu.Unlock()
}

// SetTargetBps sets the target throughput in bits/sec for auto-adjustment.
func (e *Engine) SetTargetBps(bps int64) {
	e.targetBps.Store(bps)
}

// ActiveStreams returns the current number of running download goroutines.
func (e *Engine) ActiveStreams() int {
	return int(e.activeStreams.Load())
}

// SetStatsCollector attaches a stats collector that receives byte counts.
func (e *Engine) SetStatsCollector(collector StatsCollector) {
	e.stats.Store(collector)
}

// Start launches the download goroutines. It is a no-op if the engine is
// already running.
func (e *Engine) Start(ctx context.Context) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.running.Load() {
		return
	}

	ctx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.running.Store(true)
	e.activeStreams.Store(0)

	// Stagger stream launches to avoid thundering-herd connection storms.
	// Launch first stream immediately, then space the rest ~50ms apart.
	conc := e.concurrency
	e.launchStream(ctx)
	if conc > 1 {
		e.wg.Add(1)
		go func() {
			defer e.wg.Done()
			for i := 1; i < conc; i++ {
				select {
				case <-ctx.Done():
					return
				case <-time.After(50 * time.Millisecond):
					e.launchStream(ctx)
				}
			}
		}()
	}

	// Auto-adjust goroutine
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		e.autoAdjust(ctx)
	}()
}

// launchStream starts a single download goroutine.
func (e *Engine) launchStream(ctx context.Context) {
	e.wg.Add(1)
	e.activeStreams.Add(1)
	go func() {
		defer e.wg.Done()
		defer e.activeStreams.Add(-1)
		e.downloadLoop(ctx)
	}()
}

// Stop cancels all in-flight downloads and waits for every goroutine to exit.
func (e *Engine) Stop() {
	e.mu.Lock()
	cancel := e.cancel
	e.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	e.wg.Wait()
	e.running.Store(false)
	e.activeStreams.Store(0)
}

// IsRunning reports whether the engine is actively downloading.
func (e *Engine) IsRunning() bool {
	return e.running.Load()
}

// SetRateLimit updates the aggregate rate limit in bytes per second.
// Pass 0 for unlimited. The new limit takes effect on the next read cycle
// in each goroutine.
func (e *Engine) SetRateLimit(bps int64) {
	e.rateLimitBps.Store(bps)
}

// SetConcurrency updates the number of download goroutines.
// The change only takes effect on the next call to Start().
func (e *Engine) SetConcurrency(n int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.concurrency = n
}

// newHTTPClient returns an *http.Client tuned for long-running streaming
// downloads: 30 s connection timeout, no overall request timeout.
// The client is shared across all goroutines so that connections to the
// same host are pooled and reused instead of each goroutine opening its own
// TCP connections.
func newHTTPClient() *http.Client {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: connTimeout,
		}).DialContext,
		TLSHandshakeTimeout:   connTimeout,
		MaxIdleConns:          256,
		MaxIdleConnsPerHost:   64,
		MaxConnsPerHost:       64,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: connTimeout,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   0, // no overall timeout -- we stream until EOF or cancel
	}
}

// downloadLoop is the main work function executed by each goroutine.
// It repeatedly picks a server, downloads its payload, and loops.
func (e *Engine) downloadLoop(ctx context.Context) {
	client := e.httpClient
	buf := make([]byte, readBufSize)

	for {
		if ctx.Err() != nil {
			return
		}

		serverURL := e.serverList.Next()
		if serverURL == "" {
			// No servers configured; wait a bit and retry.
			select {
			case <-ctx.Done():
				return
			case <-time.After(retrySleep):
				continue
			}
		}

		e.serverList.IncrementStreams(serverURL)
		start := time.Now()
		bytesRead, err := e.downloadFrom(ctx, client, serverURL, buf)
		e.serverList.DecrementStreams(serverURL)

		if err != nil {
			if ctx.Err() != nil {
				return // shutting down, not a server error
			}
			log.Printf("download error from %s: %v", serverURL, err)
			e.serverList.MarkUnhealthy(serverURL, err.Error())
			// Jitter the retry to avoid synchronized retry storms.
			jitter := time.Duration(rand.Int63n(int64(retrySleep)))
			select {
			case <-ctx.Done():
				return
			case <-time.After(retrySleep + jitter):
			}
		} else {
			// Completed successfully (EOF)
			e.serverList.MarkSuccess(serverURL)

			// Update speed score if the download ran long enough for a meaningful measurement.
			elapsed := time.Since(start)
			if elapsed > time.Second {
				bps := bytesRead * 8 / int64(elapsed.Seconds())
				e.serverList.UpdateSpeedScore(serverURL, bps)
			}
		}
	}
}

// downloadFrom performs a single HTTP GET against serverURL, streaming the
// response body through rate limiting and reporting bytes to the stats
// collector.
func (e *Engine) downloadFrom(ctx context.Context, client *http.Client, serverURL string, buf []byte) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL, nil)
	if err != nil {
		return 0, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Accept-Encoding", "identity")

	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return 0, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	// Build or rebuild the rate limiter based on the current setting.
	// We read activeStreams live so that the per-worker budget stays correct
	// as auto-adjust adds or removes goroutines during this download.
	var limiter *rate.Limiter
	lastLimit := e.rateLimitBps.Load()
	lastWorkers := int64(e.activeStreams.Load())
	if lastWorkers < 1 {
		lastWorkers = 1
	}
	if lastLimit > 0 {
		perWorker := float64(lastLimit) / float64(lastWorkers)
		limiter = rate.NewLimiter(rate.Limit(perWorker), burstSize)
	}

	var totalRead int64
	for {
		// Re-evaluate the rate limit whenever either the aggregate limit or the
		// live worker count changes.  This ensures per-worker budgets stay
		// accurate as auto-adjust adds streams mid-download.
		currentLimit := e.rateLimitBps.Load()
		currentWorkers := int64(e.activeStreams.Load())
		if currentWorkers < 1 {
			currentWorkers = 1
		}
		if currentLimit != lastLimit || currentWorkers != lastWorkers {
			lastLimit = currentLimit
			lastWorkers = currentWorkers
			if currentLimit > 0 {
				perWorker := float64(currentLimit) / float64(currentWorkers)
				if limiter == nil {
					limiter = rate.NewLimiter(rate.Limit(perWorker), burstSize)
				} else {
					limiter.SetLimit(rate.Limit(perWorker))
				}
			} else {
				limiter = nil
			}
		}

		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			totalRead += int64(n)

			// Rate-limit the throughput.
			if limiter != nil {
				if err := limiter.WaitN(ctx, n); err != nil {
					return totalRead, err
				}
			}

			// Report bytes to the stats collector.
			if v := e.stats.Load(); v != nil {
				if sc, ok := v.(StatsCollector); ok {
					sc.AddDownloadBytes(int64(n))
				}
			}
			// Update per-server byte counter for health UI.
			e.serverList.AddBytes(serverURL, int64(n))
		}

		if readErr != nil {
			if readErr == io.EOF {
				return totalRead, nil // finished; caller will loop back for a new download
			}
			return totalRead, fmt.Errorf("reading body: %w", readErr)
		}
	}
}

// autoAdjust monitors throughput and adds streams if below target.
func (e *Engine) autoAdjust(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	var lastMaxLog time.Time // throttle "at max streams" events to once per 60s

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			e.mu.Lock()
			provider := e.statsProvider
			maxConc := e.maxConcurrency
			eb := e.eventBuf
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

			// If below 80% of target and room for more streams, add streams
			// proportional to the deficit. When far below target (e.g. 1% of
			// capacity) we add aggressively; when close we add conservatively.
			if current < target*80/100 && active < maxConc {
				// Add up to 4 streams at once, scaled by how far below target we are.
				// deficit fraction: 0.0 = at target, 1.0 = zero throughput.
				deficitFraction := 1.0 - float64(current)/float64(target)
				toAdd := int(deficitFraction*4) + 1
				if toAdd < 1 {
					toAdd = 1
				}
				if active+toAdd > maxConc {
					toAdd = maxConc - active
				}
				for i := 0; i < toAdd; i++ {
					e.launchStream(ctx)
				}
				log.Printf("download auto-adjust: added %d stream(s) (now %d, current=%dMbps, target=%dMbps)",
					toAdd, e.activeStreams.Load(), current/1_000_000, target/1_000_000)
				if eb != nil {
					eb.Add("stream", fmt.Sprintf("+%d download stream(s) → %d total", toAdd, e.activeStreams.Load()))
				}
				lastMaxLog = time.Time{} // reset so next cap-hit is reported immediately
			} else if current < target*80/100 && active >= maxConc {
				if time.Since(lastMaxLog) >= 60*time.Second {
					pct := current * 100 / target
					log.Printf("download auto-adjust: at max streams (%d), %d%% of target", active, pct)
					if eb != nil {
						eb.Add("adjust", fmt.Sprintf("at max download streams (%d), %d%% of target", active, pct))
					}
					lastMaxLog = time.Now()
				}
			}
		}
	}
}
