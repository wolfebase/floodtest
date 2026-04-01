package download

import (
	"sync"
	"sync/atomic"
	"time"
)

const (
	unhealthyCooldown = 30 * time.Second
	maxCooldown       = 10 * time.Minute
	speedSampleWindow = 5
)

// ServerEntry pairs a URL with a human-readable location tag.
type ServerEntry struct {
	URL      string
	Location string
}

// DefaultServerEntries is the canonical list of speed-test servers with locations.
var DefaultServerEntries = []ServerEntry{
	// --- Hetzner (US, Germany, Finland) — 10 GB files ---
	{"http://ash-speed.hetzner.com/10GB.bin", "Ashburn, VA, US"},
	{"http://speed.hetzner.de/10GB.bin", "Falkenstein, DE"},
	{"http://fsn1-speed.hetzner.com/10GB.bin", "Falkenstein, DE"},
	{"http://nbg1-speed.hetzner.com/10GB.bin", "Nuremberg, DE"},
	{"http://hel1-speed.hetzner.com/10GB.bin", "Helsinki, FI"},

	// --- OVH (France) — 10 GB ---
	{"http://proof.ovh.net/files/10Gb.dat", "Gravelines, FR"},

	// --- Leaseweb (US) — 10 GB ---
	{"http://mirror.us.leaseweb.net/speedtest/10000mb.bin", "Manassas, VA, US"},
	{"http://mirror.wdc1.us.leaseweb.net/speedtest/10000mb.bin", "Washington DC, US"},
	{"http://mirror.sfo12.us.leaseweb.net/speedtest/10000mb.bin", "San Francisco, CA, US"},
	{"http://mirror.dal10.us.leaseweb.net/speedtest/10000mb.bin", "Dallas, TX, US"},

	// --- Scaleway / Online.net (France) — 10 GB ---
	{"http://ping.online.net/10000Mo.dat", "Paris, FR"},
	{"http://scaleway.testdebit.info/10G.iso", "Paris, FR"},

	// --- European Providers — large files ---
	{"http://speedtest.belwue.net/10G", "Stuttgart, DE"},
	{"http://speedtest.tele2.net/10GB.zip", "Stockholm, SE"},
	{"http://speedtest.serverius.net/files/10000mb.bin", "Dronten, NL"},

	// --- Vultr US (1 GB files) ---
	{"http://lax-ca-us-ping.vultr.com/vultr.com.1000MB.bin", "Los Angeles, CA, US"},
	{"http://nj-us-ping.vultr.com/vultr.com.1000MB.bin", "New Jersey, US"},
	{"http://il-us-ping.vultr.com/vultr.com.1000MB.bin", "Chicago, IL, US"},
	{"http://tx-us-ping.vultr.com/vultr.com.1000MB.bin", "Dallas, TX, US"},
	{"http://ga-us-ping.vultr.com/vultr.com.1000MB.bin", "Atlanta, GA, US"},
	{"http://sea-us-ping.vultr.com/vultr.com.1000MB.bin", "Seattle, WA, US"},

	// --- Vultr EU (1 GB files) ---
	{"http://ams-nl-ping.vultr.com/vultr.com.1000MB.bin", "Amsterdam, NL"},
	{"http://fra-de-ping.vultr.com/vultr.com.1000MB.bin", "Frankfurt, DE"},
	{"http://par-fr-ping.vultr.com/vultr.com.1000MB.bin", "Paris, FR"},

	// --- Linode / Akamai US (100 MB files) ---
	{"http://speedtest.newark.linode.com/100MB-newark.bin", "Newark, NJ, US"},
	{"http://speedtest.atlanta.linode.com/100MB-atlanta.bin", "Atlanta, GA, US"},
	{"http://speedtest.dallas.linode.com/100MB-dallas.bin", "Dallas, TX, US"},
	{"http://speedtest.fremont.linode.com/100MB-fremont.bin", "Fremont, CA, US"},
	{"http://speedtest.chicago.linode.com/100MB-chicago.bin", "Chicago, IL, US"},

	// --- Clouvider (10 GB files) ---
	{"http://lon.speedtest.clouvider.net/10G.bin", "London, UK"},
	{"http://nyc.speedtest.clouvider.net/10G.bin", "New York, NY, US"},
	{"http://dal.speedtest.clouvider.net/10G.bin", "Dallas, TX, US"},
	{"http://la.speedtest.clouvider.net/10G.bin", "Los Angeles, CA, US"},

	// --- FDCservers (10 GB files) ---
	{"http://lg.chi.fdcservers.net/10GBtest.zip", "Chicago, IL, US"},
	{"http://lg.den.fdcservers.net/10GBtest.zip", "Denver, CO, US"},
	{"http://lg.atl.fdcservers.net/10GBtest.zip", "Atlanta, GA, US"},

	// --- WorldStream (10 GB) ---
	{"http://speedtest.worldstream.nl/10G.bin", "Naaldwijk, NL"},

	// --- ThinkBroadband UK (1 GB) ---
	{"http://ipv4.download.thinkbroadband.com/1GB.zip", "London, UK"},

	// --- Leaseweb EU (10 GB) ---
	{"http://mirror.nl.leaseweb.net/speedtest/10000mb.bin", "Haarlem, NL"},
	{"http://mirror.de.leaseweb.net/speedtest/10000mb.bin", "Frankfurt, DE"},

	// --- Vultr additional US (1 GB) ---
	{"http://fl-us-ping.vultr.com/vultr.com.1000MB.bin", "Miami, FL, US"},
	{"http://wa-us-ping.vultr.com/vultr.com.1000MB.bin", "Seattle, WA, US"},

	// --- Vultr additional EU (1 GB) ---
	{"http://lon-gb-ping.vultr.com/vultr.com.1000MB.bin", "London, UK"},

	// --- Hetzner US West (10 GB) ---
	{"http://hil-speed.hetzner.com/10GB.bin", "Hillsboro, OR, US"},
}

// DefaultServers is the flat URL list derived from DefaultServerEntries.
// Kept for backward compatibility with config and callers that only need URLs.
var DefaultServers []string

func init() {
	DefaultServers = make([]string, len(DefaultServerEntries))
	for i, e := range DefaultServerEntries {
		DefaultServers[i] = e.URL
	}
}

// ServerHealth contains the current health status of a download server,
// exported for API consumption.
type ServerHealth struct {
	URL                 string    `json:"url"`
	Location            string    `json:"location"`
	Healthy             bool      `json:"healthy"`
	ConsecutiveFailures int       `json:"consecutiveFailures"`
	TotalFailures       int       `json:"totalFailures"`
	TotalDownloads      int       `json:"totalDownloads"`
	LastError           string    `json:"lastError,omitempty"`
	LastErrorTime       time.Time `json:"lastErrorTime,omitempty"`
	UnhealthyUntil      time.Time `json:"unhealthyUntil,omitempty"`
	BytesDownloaded     int64     `json:"bytesDownloaded"`
	SpeedBps            int64     `json:"speedBps"`
	ActiveStreams       int       `json:"activeStreams"`
	Status              string    `json:"status"`
}

// Server represents a single download endpoint with health tracking.
type Server struct {
	URL                 string
	Location            string
	healthy             bool
	unhealthyUntil      time.Time
	consecutiveFailures int
	totalFailures       int
	totalDownloads      int
	lastError           string
	lastErrorTime       time.Time
	bytesDownloaded     int64
	speedScore          int64
	speedSamples        []int64
	activeStreams       int32
	testing             bool
}

// ServerList manages a thread-safe list of download servers
// with per-server health tracking, weighted selection, and automatic cooldown recovery.
type ServerList struct {
	mu      sync.RWMutex
	servers []Server
	index   int
}

// buildLocationMap returns a URL → Location mapping from DefaultServerEntries.
func buildLocationMap() map[string]string {
	m := make(map[string]string, len(DefaultServerEntries))
	for _, e := range DefaultServerEntries {
		m[e.URL] = e.Location
	}
	return m
}

// NewServerList creates a ServerList from the given URLs.
// All servers start in the healthy state. Locations are resolved
// from DefaultServerEntries when available.
func NewServerList(urls []string) *ServerList {
	locMap := buildLocationMap()
	servers := make([]Server, len(urls))
	for i, u := range urls {
		servers[i] = Server{URL: u, Location: locMap[u], healthy: true}
	}
	return &ServerList{servers: servers}
}

// Next returns the URL of the next server to use.
//
// Selection strategy:
//  1. Promote any servers whose cooldown has expired.
//  2. Collect healthy, non-testing servers.
//  3. If no speed scores exist yet, fall back to round-robin.
//  4. Otherwise pick the server with the best score/(activeStreams+1) ratio.
//  5. If all servers are unhealthy, return the one whose cooldown expires soonest.
func (sl *ServerList) Next() string {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	if len(sl.servers) == 0 {
		return ""
	}

	now := time.Now()

	// Phase 1: promote servers whose cooldown expired.
	for i := range sl.servers {
		s := &sl.servers[i]
		if !s.healthy && now.After(s.unhealthyUntil) {
			s.healthy = true
			s.unhealthyUntil = time.Time{}
			s.consecutiveFailures = 0
		}
	}

	// Phase 2: collect eligible (healthy, non-testing) servers.
	type candidate struct {
		idx   int
		score int64
	}
	var candidates []candidate
	hasScores := false

	for i := range sl.servers {
		s := &sl.servers[i]
		if s.healthy && !s.testing {
			candidates = append(candidates, candidate{idx: i, score: s.speedScore})
			if s.speedScore > 0 {
				hasScores = true
			}
		}
	}

	// Phase 3: if no eligible servers, pick the one with soonest recovery.
	if len(candidates) == 0 {
		var bestIdx int
		var bestTime time.Time
		first := true
		for i := range sl.servers {
			s := &sl.servers[i]
			if first || s.unhealthyUntil.Before(bestTime) {
				bestIdx = i
				bestTime = s.unhealthyUntil
				first = false
			}
		}
		sl.index = (sl.index + 1) % len(sl.servers)
		return sl.servers[bestIdx].URL
	}

	// Phase 4: no speed data yet — round-robin among healthy servers.
	if !hasScores {
		start := sl.index
		for i := 0; i < len(sl.servers); i++ {
			idx := (start + i) % len(sl.servers)
			s := &sl.servers[idx]
			if s.healthy && !s.testing {
				sl.index = (idx + 1) % len(sl.servers)
				return s.URL
			}
		}
		// Fallback: first candidate.
		c := candidates[0]
		sl.index = (c.idx + 1) % len(sl.servers)
		return sl.servers[c.idx].URL
	}

	// Phase 5: weighted selection — best score / (activeStreams + 1).
	var bestIdx int
	var bestRatio float64
	first := true
	for _, c := range candidates {
		streams := atomic.LoadInt32(&sl.servers[c.idx].activeStreams)
		ratio := float64(c.score) / float64(streams+1)
		if first || ratio > bestRatio {
			bestIdx = c.idx
			bestRatio = ratio
			first = false
		}
	}
	sl.index = (bestIdx + 1) % len(sl.servers)
	return sl.servers[bestIdx].URL
}

// MarkUnhealthy marks the server identified by url as unhealthy.
// Cooldown increases with consecutive failures: 30s, 60s, 120s, ... capped at 10min.
func (sl *ServerList) MarkUnhealthy(url string, errMsg string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			s := &sl.servers[i]
			s.healthy = false
			s.consecutiveFailures++
			s.totalFailures++
			s.lastError = errMsg
			s.lastErrorTime = time.Now()

			// Exponential backoff: 30s * 2^(failures-1), capped at 10min
			cooldown := unhealthyCooldown
			for j := 1; j < s.consecutiveFailures && cooldown < maxCooldown; j++ {
				cooldown *= 2
			}
			if cooldown > maxCooldown {
				cooldown = maxCooldown
			}
			s.unhealthyUntil = time.Now().Add(cooldown)
			return
		}
	}
}

// MarkSuccess records a successful download completion from a server.
// Bytes are already counted incrementally via AddBytes, so only increment the counter.
func (sl *ServerList) MarkSuccess(url string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			sl.servers[i].consecutiveFailures = 0
			sl.servers[i].totalDownloads++
			return
		}
	}
}

// AddBytes incrementally updates the bytes downloaded counter for a server.
// Called during streaming to provide real-time progress in the health UI.
func (sl *ServerList) AddBytes(url string, n int64) {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		if sl.servers[i].URL == url {
			sl.servers[i].bytesDownloaded += n
			return
		}
	}
}

// UpdateSpeedScore records a speed sample (bytes per second) for the given server.
// A rolling window of the last 5 samples is kept, and the average becomes the score.
func (sl *ServerList) UpdateSpeedScore(url string, bps int64) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			s := &sl.servers[i]
			s.speedSamples = append(s.speedSamples, bps)
			if len(s.speedSamples) > speedSampleWindow {
				s.speedSamples = s.speedSamples[len(s.speedSamples)-speedSampleWindow:]
			}
			var sum int64
			for _, v := range s.speedSamples {
				sum += v
			}
			s.speedScore = sum / int64(len(s.speedSamples))
			return
		}
	}
}

// IncrementStreams atomically adds one to the active stream count for a server.
func (sl *ServerList) IncrementStreams(url string) {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			atomic.AddInt32(&sl.servers[i].activeStreams, 1)
			return
		}
	}
}

// DecrementStreams atomically subtracts one from the active stream count for a server.
func (sl *ServerList) DecrementStreams(url string) {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	for i := range sl.servers {
		if sl.servers[i].URL == url {
			atomic.AddInt32(&sl.servers[i].activeStreams, -1)
			return
		}
	}
}

// HealthStatus returns the current health of all servers for API/UI consumption.
func (sl *ServerList) HealthStatus() []ServerHealth {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	now := time.Now()
	result := make([]ServerHealth, len(sl.servers))
	for i, s := range sl.servers {
		healthy := s.healthy
		if !healthy && now.After(s.unhealthyUntil) {
			healthy = true // cooldown expired
		}

		status := "healthy"
		if s.testing {
			status = "testing"
		} else if !s.healthy {
			if now.Before(s.unhealthyUntil) {
				status = "cooldown"
			}
			if s.consecutiveFailures >= 5 {
				status = "failed"
			}
		}

		result[i] = ServerHealth{
			URL:                 s.URL,
			Location:            s.Location,
			Healthy:             healthy,
			ConsecutiveFailures: s.consecutiveFailures,
			TotalFailures:       s.totalFailures,
			TotalDownloads:      s.totalDownloads,
			LastError:           s.lastError,
			LastErrorTime:       s.lastErrorTime,
			UnhealthyUntil:      s.unhealthyUntil,
			BytesDownloaded:     s.bytesDownloaded,
			SpeedBps:            s.speedScore,
			ActiveStreams:       int(atomic.LoadInt32(&sl.servers[i].activeStreams)),
			Status:              status,
		}
	}
	return result
}

// UpdateServers replaces the entire server list with the given URLs.
// All new servers start healthy and the round-robin index is reset.
func (sl *ServerList) UpdateServers(urls []string) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	locMap := buildLocationMap()
	servers := make([]Server, len(urls))
	for i, u := range urls {
		servers[i] = Server{URL: u, Location: locMap[u], healthy: true}
	}
	sl.servers = servers
	sl.index = 0
}

// HealthyCount returns the number of currently healthy servers.
func (sl *ServerList) HealthyCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()

	now := time.Now()
	count := 0
	for _, s := range sl.servers {
		if s.healthy || now.After(s.unhealthyUntil) {
			count++
		}
	}
	return count
}

// TotalCount returns the total number of configured servers.
func (sl *ServerList) TotalCount() int {
	sl.mu.RLock()
	defer sl.mu.RUnlock()
	return len(sl.servers)
}

// ResetCooldowns marks all servers as healthy, clearing any backoff state.
func (sl *ServerList) ResetCooldowns() {
	sl.mu.Lock()
	defer sl.mu.Unlock()
	for i := range sl.servers {
		sl.servers[i].healthy = true
		sl.servers[i].unhealthyUntil = time.Time{}
		sl.servers[i].consecutiveFailures = 0
	}
}
