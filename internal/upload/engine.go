package upload

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
	"golang.org/x/time/rate"
)

// StatsCollector receives byte-count updates from the upload engine.
type StatsCollector interface {
	AddUploadBytes(n int64)
}

// Engine generates random data and uploads it to Backblaze B2 via the
// S3-compatible API, then immediately deletes the uploaded objects.
type Engine struct {
	s3Client       *s3.Client
	bucketName     string
	concurrency    int
	maxConcurrency int
	chunkSizeBytes int64
	rateLimitBps   atomic.Int64 // 0 = unlimited
	targetBps      atomic.Int64 // target throughput in bits/sec
	activeStreams  atomic.Int32
	running        atomic.Bool
	cancel         context.CancelFunc
	wg             sync.WaitGroup
	stats          StatsCollector
	statsProvider  func() int64

	// Credentials stored for (re-)creating the S3 client on Start.
	mu       sync.Mutex
	keyID    string
	appKey   string
	endpoint string
	bucket   string
	eventBuf interface{ Add(kind, message string) }
}

// New creates an Engine but does NOT establish an S3 connection yet.
// Call Start to create the client and begin uploading.
func New(keyID, appKey, bucket, endpoint string, concurrency int, chunkSizeBytes int64, rateLimitBps int64) *Engine {
	e := &Engine{
		bucketName:     bucket,
		concurrency:    concurrency,
		maxConcurrency: 32,
		chunkSizeBytes: chunkSizeBytes,
		keyID:          keyID,
		appKey:         appKey,
		endpoint:       endpoint,
		bucket:         bucket,
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

// SetStatsCollector assigns the collector that receives upload byte counts.
func (e *Engine) SetStatsCollector(c StatsCollector) {
	e.stats = c
}

// SetStatsProvider sets a function returning current upload bps for auto-adjust.
func (e *Engine) SetStatsProvider(fn func() int64) {
	e.mu.Lock()
	e.statsProvider = fn
	e.mu.Unlock()
}

// SetTargetBps sets the target throughput in bits/sec for auto-adjustment.
func (e *Engine) SetTargetBps(bps int64) {
	e.targetBps.Store(bps)
}

// ActiveStreams returns the current number of running upload goroutines.
func (e *Engine) ActiveStreams() int {
	return int(e.activeStreams.Load())
}

// Start creates the S3 client and launches upload goroutines.
func (e *Engine) Start(ctx context.Context) error {
	e.mu.Lock()
	keyID := e.keyID
	appKey := e.appKey
	endpoint := e.endpoint
	bucket := e.bucket
	e.mu.Unlock()

	client, err := CreateS3Client(keyID, appKey, endpoint)
	if err != nil {
		return fmt.Errorf("create S3 client: %w", err)
	}
	e.s3Client = client
	e.bucketName = bucket

	// Run startup cleanup of orphaned objects from previous runs.
	if err := Cleanup(ctx, e.s3Client, e.bucketName); err != nil {
		log.Printf("upload: cleanup warning: %v", err)
	}

	childCtx, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	e.running.Store(true)

	e.activeStreams.Store(0)
	for i := 0; i < e.concurrency; i++ {
		e.launchStream(childCtx)
	}

	// Auto-adjust goroutine
	e.wg.Add(1)
	go func() {
		defer e.wg.Done()
		e.autoAdjust(childCtx)
	}()

	return nil
}

func (e *Engine) launchStream(ctx context.Context) {
	e.wg.Add(1)
	e.activeStreams.Add(1)
	go func() {
		defer e.wg.Done()
		defer e.activeStreams.Add(-1)
		e.uploadLoop(ctx)
	}()
}

// Stop cancels all upload goroutines and waits for them to finish.
func (e *Engine) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
	e.wg.Wait()
	e.running.Store(false)
	e.activeStreams.Store(0)
}

// IsRunning reports whether the engine is currently active.
func (e *Engine) IsRunning() bool {
	return e.running.Load()
}

// SetRateLimit changes the aggregate rate limit (bytes/sec). 0 = unlimited.
func (e *Engine) SetRateLimit(bps int64) {
	e.rateLimitBps.Store(bps)
}

// SetConcurrency stores a new concurrency value that takes effect on the next Start.
func (e *Engine) SetConcurrency(n int) {
	e.mu.Lock()
	e.concurrency = n
	e.mu.Unlock()
}

// SetChunkSize updates the upload chunk size in bytes. Takes effect on next upload iteration.
func (e *Engine) SetChunkSize(bytes int64) {
	e.mu.Lock()
	e.chunkSizeBytes = bytes
	e.mu.Unlock()
}

// UpdateCredentials stores new B2 credentials that take effect on the next Start.
func (e *Engine) UpdateCredentials(keyID, appKey, bucket, endpoint string) {
	e.mu.Lock()
	e.keyID = keyID
	e.appKey = appKey
	e.bucket = bucket
	e.endpoint = endpoint
	e.mu.Unlock()
}

// CreateS3Client builds an S3 client pointing at the given B2 endpoint.
func CreateS3Client(keyID, appKey, endpoint string) (*s3.Client, error) {
	client := s3.New(s3.Options{
		Region: "us-west-004",
		BaseEndpoint: aws.String(endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider(keyID, appKey, ""),
		UsePathStyle: true,
	})
	return client, nil
}

// uploadLoop repeatedly generates random data, uploads it, and deletes
// the resulting object until the context is cancelled.
func (e *Engine) uploadLoop(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}

		objectKey := fmt.Sprintf("wan-test/%s", uuid.New().String())

		pr, pw := io.Pipe()

		// Determine per-stream rate limit.
		totalBps := e.rateLimitBps.Load()
		e.mu.Lock()
		conc := e.concurrency
		e.mu.Unlock()

		var limiter *rate.Limiter
		if totalBps > 0 && conc > 0 {
			perStream := totalBps / int64(conc)
			if perStream < 1 {
				perStream = 1
			}
			// Allow bursts of up to 256KB.
			burst := int(perStream)
			if burst > 256*1024 {
				burst = 256 * 1024
			}
			limiter = rate.NewLimiter(rate.Limit(perStream), burst)
		}

		chunkSize := e.chunkSizeBytes

		// Writer goroutine: push random data into the pipe.
		go func() {
			defer pw.Close()
			buf := make([]byte, 256*1024) // 256KB write buffer
			var written int64
			for written < chunkSize {
				if ctx.Err() != nil {
					return
				}

				toWrite := int64(len(buf))
				if remaining := chunkSize - written; remaining < toWrite {
					toWrite = remaining
				}

				n, err := rand.Read(buf[:toWrite])
				if err != nil {
					pw.CloseWithError(fmt.Errorf("rand read: %w", err))
					return
				}

				// Apply rate limiting if configured.
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

		// Wrap the reader so we can count bytes as they are consumed.
		reader := &CountingReader{r: pr, stats: e.stats}

		_, err := e.s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:        aws.String(e.bucketName),
			Key:           aws.String(objectKey),
			Body:          reader,
			ContentLength: aws.Int64(chunkSize),
		})
		if err != nil {
			// Drain the pipe so the writer goroutine can exit.
			pr.CloseWithError(err)
			if ctx.Err() != nil {
				return
			}
			errStr := err.Error()
			if strings.Contains(errStr, "cap exceeded") || strings.Contains(errStr, "AccessDenied") {
				log.Printf("upload: storage cap exceeded — pausing uploads for 5 minutes")
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Minute):
				}
				continue
			}
			log.Printf("upload: PutObject error: %v", err)
			time.Sleep(2 * time.Second)
			continue
		}

		// Delete the object immediately to avoid storage charges.
		// Retry up to 3 times — failed deletes accumulate storage.
		for attempt := 0; attempt < 3; attempt++ {
			_, err = e.s3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(e.bucketName),
				Key:    aws.String(objectKey),
			})
			if err == nil {
				break
			}
			if ctx.Err() != nil {
				return
			}
			log.Printf("upload: DeleteObject retry %d for %s: %v", attempt+1, objectKey, err)
			time.Sleep(1 * time.Second)
		}
	}
}

// CountingReader wraps an io.Reader and reports bytes read to a StatsCollector.
type CountingReader struct {
	r     io.Reader
	stats StatsCollector
}

func (cr *CountingReader) Read(p []byte) (int, error) {
	n, err := cr.r.Read(p)
	if n > 0 && cr.stats != nil {
		cr.stats.AddUploadBytes(int64(n))
	}
	return n, err
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

			if current < target*80/100 && active < maxConc {
				e.launchStream(ctx)
				log.Printf("upload auto-adjust: added stream (now %d, current=%dMbps, target=%dMbps)",
					e.activeStreams.Load(), current/1_000_000, target/1_000_000)
				if eb != nil {
					eb.Add("stream", fmt.Sprintf("+1 upload stream → %d total", e.activeStreams.Load()))
				}
				lastMaxLog = time.Time{} // reset so next cap-hit is reported immediately
			} else if current < target*80/100 && active >= maxConc {
				if time.Since(lastMaxLog) >= 60*time.Second {
					pct := current * 100 / target
					log.Printf("upload auto-adjust: at max streams (%d), %d%% of target", active, pct)
					if eb != nil {
						eb.Add("adjust", fmt.Sprintf("at max upload streams (%d), %d%% of target", active, pct))
					}
					lastMaxLog = time.Now()
				}
			}
		}
	}
}
