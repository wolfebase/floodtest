package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

var (
	instance *sql.DB
	once     sync.Once
)

func Open(dataDir string) (*sql.DB, error) {
	var err error
	once.Do(func() {
		if e := os.MkdirAll(dataDir, 0755); e != nil {
			err = fmt.Errorf("create data dir: %w", e)
			return
		}
		dbPath := filepath.Join(dataDir, "wansaturator.db")
		instance, err = sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
		if err != nil {
			err = fmt.Errorf("open database: %w", err)
			return
		}
		instance.SetMaxOpenConns(1)
		if _, e := instance.Exec(schema); e != nil {
			err = fmt.Errorf("run migrations: %w", e)
		}
	})
	return instance, err
}

// OpenDB opens a SQLite database at the given path (or ":memory:" for tests)
// and runs migrations. Unlike Open(), this does NOT use a singleton — each
// call returns an independent connection.
func OpenDB(dsn string) (*sql.DB, error) {
	if dsn == ":memory:" {
		dsn = ":memory:?_journal_mode=WAL&_busy_timeout=5000"
	}
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	conn.SetMaxOpenConns(1)
	if _, err := conn.Exec(schema); err != nil {
		conn.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return conn, nil
}

// GetSetting reads a setting from the database.
func GetSetting(db *sql.DB, key string) (string, error) {
	var value string
	err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

// SetSetting writes a setting to the database.
func SetSetting(db *sql.DB, key, value string) error {
	_, err := db.Exec(
		"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		key, value,
	)
	return err
}
