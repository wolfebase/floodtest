package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
	"wansaturator/internal/events"
)

type WsMessage struct {
	DownloadBps          int64 `json:"downloadBps"`
	UploadBps            int64 `json:"uploadBps"`
	DownloadStreams       int   `json:"downloadStreams"`
	UploadStreams         int   `json:"uploadStreams"`
	UptimeSeconds        int64 `json:"uptimeSeconds"`
	Running              bool  `json:"running"`
	SessionDownloadBytes int64 `json:"sessionDownloadBytes"`
	SessionUploadBytes   int64 `json:"sessionUploadBytes"`
	HealthyServers       int   `json:"healthyServers"`
	TotalServers         int   `json:"totalServers"`
	HealthyUploadServers int   `json:"healthyUploadServers"`
	TotalUploadServers   int   `json:"totalUploadServers"`
	SpeedTestRunning     bool    `json:"speedTestRunning,omitempty"`
	SpeedTestCompleted   int     `json:"speedTestCompleted,omitempty"`
	SpeedTestTotal       int     `json:"speedTestTotal,omitempty"`
	AutoMode             string  `json:"autoMode,omitempty"`
	MeasuredDownloadMbps float64 `json:"measuredDownloadMbps,omitempty"`
	MeasuredUploadMbps   float64 `json:"measuredUploadMbps,omitempty"`
	ISPTestRunning       bool    `json:"ispTestRunning,omitempty"`
	ISPTestPhase         string  `json:"ispTestPhase,omitempty"`
	ISPTestProgress      int              `json:"ispTestProgress,omitempty"`
	PeakDownloadBps      int64            `json:"peakDownloadBps,omitempty"`
	PeakUploadBps        int64            `json:"peakUploadBps,omitempty"`
	Events               []events.Event   `json:"events,omitempty"`
}

type WsHub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]struct{}
}

func NewWsHub() *WsHub {
	return &WsHub{
		clients: make(map[*websocket.Conn]struct{}),
	}
}

func (h *WsHub) HandleWs(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("websocket accept: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	// Keep connection alive by reading (and discarding) client messages
	ctx := conn.CloseRead(r.Context())
	<-ctx.Done()

	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
	conn.Close(websocket.StatusNormalClosure, "")
}

func (h *WsHub) Broadcast(msg WsMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	h.mu.RLock()
	clients := make([]*websocket.Conn, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := c.Write(ctx, websocket.MessageText, data); err != nil {
			h.mu.Lock()
			delete(h.clients, c)
			h.mu.Unlock()
			c.Close(websocket.StatusInternalError, "write failed")
		}
		cancel()
	}
}
