package api

import (
	"embed"
	"io/fs"
	"net/http"
)

func NewRouter(app *App, frontend embed.FS) http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("GET /api/status", app.HandleStatus)
	mux.HandleFunc("POST /api/start", app.HandleStart)
	mux.HandleFunc("POST /api/stop", app.HandleStop)
	mux.HandleFunc("GET /api/history", app.HandleHistory)
	mux.HandleFunc("GET /api/usage", app.HandleUsage)
	mux.HandleFunc("GET /api/throttle-events", app.HandleThrottleEvents)

	mux.HandleFunc("GET /api/schedules", app.HandleGetSchedules)
	mux.HandleFunc("POST /api/schedules", app.HandleCreateSchedule)
	mux.HandleFunc("PUT /api/schedules/{id}", app.HandleUpdateSchedule)
	mux.HandleFunc("DELETE /api/schedules/{id}", app.HandleDeleteSchedule)

	mux.HandleFunc("GET /api/settings", app.HandleGetSettings)
	mux.HandleFunc("PUT /api/settings", app.HandleUpdateSettings)
	mux.HandleFunc("POST /api/settings/test-b2", app.HandleTestB2)
	mux.HandleFunc("GET /api/settings/setup-required", app.HandleSetupRequired)
	mux.HandleFunc("GET /api/server-health", app.HandleServerHealth)
	mux.HandleFunc("POST /api/speed-test", app.HandleSpeedTest)
	mux.HandleFunc("POST /api/upload-sink", app.HandleUploadSink)
	mux.HandleFunc("GET /api/upload-server-health", app.HandleUploadServerHealth)

	mux.HandleFunc("GET /api/updates/status", app.HandleUpdateStatus)
	mux.HandleFunc("POST /api/updates/check", app.HandleCheckUpdate)
	mux.HandleFunc("POST /api/updates/apply", app.HandleApplyUpdate)
	mux.HandleFunc("POST /api/updates/auto", app.HandleSetAutoUpdate)
	mux.HandleFunc("GET /api/updates/history", app.HandleUpdateHistory)

	// WebSocket
	mux.HandleFunc("/ws", app.Hub.HandleWs)

	// Static frontend files
	distFS, err := fs.Sub(frontend, "frontend/dist")
	if err != nil {
		// If frontend isn't embedded (dev mode), serve a placeholder
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`<html><body><h1>FloodTest API</h1><p>Frontend not embedded. Run frontend dev server separately.</p></body></html>`))
		})
	} else {
		fileServer := http.FileServer(http.FS(distFS))
		mux.Handle("/", spaHandler(fileServer, distFS))
	}

	return LoggingMiddleware(mux)
}

// spaHandler serves static files, falling back to index.html for SPA routing
func spaHandler(fileServer http.Handler, fsys fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else {
			path = path[1:] // strip leading /
		}

		// Try to open the file
		if _, err := fs.Stat(fsys, path); err != nil {
			// File doesn't exist, serve index.html for SPA routing
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}
