package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"wansaturator/internal/api"
	"wansaturator/internal/config"
	"wansaturator/internal/db"
	"wansaturator/internal/download"
	"wansaturator/internal/scheduler"
	"wansaturator/internal/stats"
	"wansaturator/internal/throttle"
	"wansaturator/internal/updater"
	"wansaturator/internal/upload"

	"github.com/aws/aws-sdk-go-v2/service/s3"
)

//go:embed all:frontend/dist
var frontend embed.FS

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("FloodTest starting...")

	// Data directory
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "/data"
	}

	// Open database
	database, err := db.Open(dataDir)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	// Load config
	cfg := config.New(database)
	log.Printf("Config loaded: download=%dMbps upload=%dMbps", cfg.DefaultDownloadMbps, cfg.DefaultUploadMbps)

	// Initialize stats collector
	collector := stats.NewCollector(database)

	// Initialize download engine
	serverList := download.NewServerList(cfg.DownloadServers)
	dlEngine := download.New(serverList, cfg.DownloadConcurrency, mbpsToBps(cfg.DefaultDownloadMbps))
	dlEngine.SetStatsCollector(collector)

	// Initialize upload engine
	ulEngine := upload.New(
		cfg.B2KeyID, cfg.B2AppKey, cfg.B2BucketName, cfg.B2Endpoint,
		cfg.UploadConcurrency,
		int64(cfg.UploadChunkSizeMB)*1024*1024,
		mbpsToBps(cfg.DefaultUploadMbps),
	)
	ulEngine.SetStatsCollector(collector)

	// Track running state
	var running atomic.Bool
	var sessionStart time.Time
	ctx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()

	// Start stats collector
	collector.Start(ctx)

	// Initialize throttle detector
	rateProvider := func(windowSeconds int) (int64, int64) {
		snapshots := collector.RecentHistory(windowSeconds)
		if len(snapshots) == 0 {
			return 0, 0
		}
		var totalDl, totalUl int64
		for _, s := range snapshots {
			totalDl += s.DownloadBps
			totalUl += s.UploadBps
		}
		return totalDl / int64(len(snapshots)), totalUl / int64(len(snapshots))
	}
	detector := throttle.NewDetector(database, rateProvider, cfg.ThrottleThresholdPct, cfg.ThrottleWindowMin)
	detector.SetTargets(mbpsToBps(cfg.DefaultDownloadMbps), mbpsToBps(cfg.DefaultUploadMbps))
	detector.Start(ctx)

	// Engine control functions
	startEngines := func(dlMbps, ulMbps int) error {
		if running.Load() {
			// Stop first
			dlEngine.Stop()
			ulEngine.Stop()
		}

		// Update rate limits
		dlEngine.SetRateLimit(mbpsToBps(dlMbps))
		ulEngine.SetRateLimit(mbpsToBps(ulMbps))

		// Update concurrency from config
		cfgNow := cfg.Get()
		dlEngine.SetConcurrency(cfgNow.DownloadConcurrency)
		ulEngine.SetConcurrency(cfgNow.UploadConcurrency)

		// Update download servers
		serverList.UpdateServers(cfgNow.DownloadServers)

		// Update upload credentials
		ulEngine.UpdateCredentials(cfgNow.B2KeyID, cfgNow.B2AppKey, cfgNow.B2BucketName, cfgNow.B2Endpoint)
		ulEngine.SetChunkSize(int64(cfgNow.UploadChunkSizeMB) * 1024 * 1024)

		// Update throttle detector targets
		detector.SetTargets(mbpsToBps(dlMbps), mbpsToBps(ulMbps))

		// Reset session counter
		collector.ResetSession()

		// Start download engine
		dlEngine.Start(ctx)
		log.Printf("Download engine started: %dMbps, %d streams", dlMbps, cfgNow.DownloadConcurrency)

		// Start upload engine (only if B2 is configured)
		if cfgNow.B2KeyID != "" && cfgNow.B2AppKey != "" && cfgNow.B2BucketName != "" {
			if err := ulEngine.Start(ctx); err != nil {
				log.Printf("Upload engine failed to start: %v", err)
				// Continue with download only
			} else {
				log.Printf("Upload engine started: %dMbps, %d streams", ulMbps, cfgNow.UploadConcurrency)
			}
		} else {
			log.Println("Upload engine skipped: B2 not configured")
		}

		running.Store(true)
		sessionStart = time.Now()
		return nil
	}

	stopEngines := func() {
		if !running.Load() {
			return
		}
		dlEngine.Stop()
		ulEngine.Stop()
		running.Store(false)
		log.Println("Engines stopped")
	}

	// Initialize scheduler
	controller := &engineController{
		start: startEngines,
		stop:  stopEngines,
		isRunning: func() bool { return running.Load() },
	}
	sched := scheduler.NewScheduler(database, controller)
	sched.Start(ctx)

	// B2 cleanup on startup (async)
	go func() {
		cfgNow := cfg.Get()
		if cfgNow.B2KeyID == "" || cfgNow.B2AppKey == "" || cfgNow.B2BucketName == "" {
			return
		}
		client, err := upload.CreateS3Client(cfgNow.B2KeyID, cfgNow.B2AppKey, cfgNow.B2Endpoint)
		if err != nil {
			log.Printf("B2 cleanup: failed to create client: %v", err)
			return
		}
		if err := upload.Cleanup(ctx, client, cfgNow.B2BucketName); err != nil {
			log.Printf("B2 cleanup: %v", err)
		}
	}()

	// Setup API
	hub := api.NewWsHub()
	app := &api.App{
		DB:        database,
		Config:    cfg,
		Scheduler: sched,
		Hub:       hub,
		OnStart:   startEngines,
		OnStop:    stopEngines,
		IsRunning: func() bool { return running.Load() },
		GetDownloadStreams: func() int {
			if dlEngine.IsRunning() {
				return cfg.Get().DownloadConcurrency
			}
			return 0
		},
		GetUploadStreams: func() int {
			if ulEngine.IsRunning() {
				return cfg.Get().UploadConcurrency
			}
			return 0
		},
		GetSessionStart:         func() time.Time { return sessionStart },
		GetSessionDownloadBytes: func() int64 { return collector.SessionDownloadBytes() },
		GetSessionUploadBytes:   func() int64 { return collector.SessionUploadBytes() },
		GetCurrentDownloadBps:   func() int64 { return collector.CurrentRate().DownloadBps },
		GetCurrentUploadBps:     func() int64 { return collector.CurrentRate().UploadBps },
		GetServerHealth: func() interface{} { return serverList.HealthStatus() },
		TestB2Connection: func(keyID, appKey, bucket, endpoint string) (bool, string) {
			client, err := upload.CreateS3Client(keyID, appKey, endpoint)
			if err != nil {
				return false, fmt.Sprintf("Failed to create client: %v", err)
			}
			_, err = client.HeadBucket(context.Background(), &s3.HeadBucketInput{
				Bucket: &bucket,
			})
			if err != nil {
				return false, fmt.Sprintf("Cannot access bucket '%s': %v", bucket, err)
			}
			return true, fmt.Sprintf("Successfully connected to bucket '%s'", bucket)
		},
	}

	// Initialize updater
	upd := updater.New(database)
	upd.Start(ctx)
	app.GetUpdateStatus = func() interface{} { return upd.GetStatus() }
	app.CheckForUpdate = func(ctx context.Context) (interface{}, error) {
		return upd.CheckForUpdate(ctx)
	}
	app.ApplyUpdate = func(ctx context.Context) error { return upd.ApplyUpdate(ctx) }
	app.SetAutoUpdate = func(enabled bool, schedule string) error {
		return upd.SetAutoUpdate(enabled, schedule)
	}
	app.GetUpdateHistory = func() interface{} { return upd.GetHistory() }

	router := api.NewRouter(app, frontend)

	// WebSocket broadcast goroutine
	go func() {
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				rate := collector.CurrentRate()
				isRunning := running.Load()
				var uptime int64
				var dlBps, ulBps int64
				if isRunning {
					uptime = int64(time.Since(sessionStart).Seconds())
					dlBps = rate.DownloadBps
					ulBps = rate.UploadBps
				}
				hub.Broadcast(api.WsMessage{
					DownloadBps:          dlBps,
					UploadBps:            ulBps,
					DownloadStreams:       app.GetDownloadStreams(),
					UploadStreams:         app.GetUploadStreams(),
					UptimeSeconds:        uptime,
					Running:              isRunning,
					SessionDownloadBytes: collector.SessionDownloadBytes(),
					SessionUploadBytes:   collector.SessionUploadBytes(),
					HealthyServers:       serverList.HealthyCount(),
					TotalServers:         serverList.TotalCount(),
				})
			}
		}
	}()

	// Start HTTP server
	port := cfg.WebPort
	if port == 0 {
		port = 7860
	}
	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: router,
	}

	go func() {
		log.Printf("FloodTest UI available at http://localhost:%d", port)
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Println("Shutting down...")

	// Graceful shutdown
	stopEngines()
	sched.Stop()
	detector.Stop()
	collector.Stop()
	upd.Stop()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	server.Shutdown(shutdownCtx)

	rootCancel()
	log.Println("Shutdown complete")
}

func mbpsToBps(mbps int) int64 {
	if mbps <= 0 {
		return 0
	}
	return int64(mbps) * 1_000_000 / 8
}

type engineController struct {
	start     func(downloadMbps, uploadMbps int) error
	stop      func()
	isRunning func() bool
}

func (c *engineController) StartEngines(ctx context.Context, downloadMbps, uploadMbps int) error {
	return c.start(downloadMbps, uploadMbps)
}

func (c *engineController) StopEngines() {
	c.stop()
}

func (c *engineController) IsRunning() bool {
	return c.isRunning()
}

