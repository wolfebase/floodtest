package db

const schema = `
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    days_of_week TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    download_mbps INTEGER NOT NULL,
    upload_mbps INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS throughput_history (
    timestamp DATETIME PRIMARY KEY,
    download_bytes INTEGER NOT NULL,
    upload_bytes INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
    period TEXT PRIMARY KEY,
    download_bytes INTEGER NOT NULL DEFAULT 0,
    upload_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS throttle_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    direction TEXT NOT NULL,
    target_bps INTEGER NOT NULL,
    actual_bps INTEGER NOT NULL,
    duration_seconds INTEGER DEFAULT 0,
    resolved_at DATETIME
);

CREATE TABLE IF NOT EXISTS update_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    previous_digest TEXT NOT NULL,
    new_digest TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_throughput_timestamp ON throughput_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_throttle_timestamp ON throttle_events(timestamp);
`
