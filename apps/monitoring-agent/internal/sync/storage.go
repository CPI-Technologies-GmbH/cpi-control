package sync

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"opsboard-agent/internal/crypto"

	_ "modernc.org/sqlite"
)

// Storage provides height-based persistent storage for signed check result blocks
// using SQLite (pure Go, no CGO).
type Storage struct {
	mu sync.Mutex
	db *sql.DB
}

// NewStorage opens (or creates) the SQLite database at dbPath and initializes the schema.
func NewStorage(dbPath string) (*Storage, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database %s: %w", dbPath, err)
	}

	// Enable WAL mode for better concurrent read performance
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		db.Close()
		return nil, fmt.Errorf("enable WAL mode: %w", err)
	}

	// Set busy timeout to avoid SQLITE_BUSY errors
	if _, err := db.Exec("PRAGMA busy_timeout=5000"); err != nil {
		db.Close()
		return nil, fmt.Errorf("set busy timeout: %w", err)
	}

	if err := createTables(db); err != nil {
		db.Close()
		return nil, err
	}

	slog.Info("sync storage initialized", "path", dbPath)
	return &Storage{db: db}, nil
}

func createTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS results (
		height    INTEGER PRIMARY KEY,
		agent_id  TEXT NOT NULL,
		timestamp TEXT NOT NULL,
		checks    TEXT NOT NULL,
		hash      TEXT NOT NULL,
		signature TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS sync_state (
		peer_id     TEXT PRIMARY KEY,
		last_height INTEGER NOT NULL DEFAULT 0,
		last_sync   TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_results_agent_id ON results(agent_id);
	CREATE INDEX IF NOT EXISTS idx_results_timestamp ON results(timestamp);
	`

	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	return nil
}

// NextHeight returns MAX(height) + 1, or 1 if the table is empty.
func (s *Storage) NextHeight() (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var maxHeight sql.NullInt64
	err := s.db.QueryRow("SELECT MAX(height) FROM results").Scan(&maxHeight)
	if err != nil {
		return 0, fmt.Errorf("query max height: %w", err)
	}

	if !maxHeight.Valid {
		return 1, nil
	}
	return maxHeight.Int64 + 1, nil
}

// StoreResult persists a signed check result block.
func (s *Storage) StoreResult(block *crypto.CheckResultBlock) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	checksJSON, err := json.Marshal(block.Checks)
	if err != nil {
		return fmt.Errorf("marshal checks: %w", err)
	}

	_, err = s.db.Exec(
		`INSERT OR REPLACE INTO results (height, agent_id, timestamp, checks, hash, signature) VALUES (?, ?, ?, ?, ?, ?)`,
		block.Height, block.AgentID, block.Timestamp, string(checksJSON), block.Hash, block.Signature,
	)
	if err != nil {
		return fmt.Errorf("insert result at height %d: %w", block.Height, err)
	}

	return nil
}

// GetResultsSince retrieves up to limit results with height > sinceHeight, ordered by height ascending.
func (s *Storage) GetResultsSince(height int64, limit int) ([]*crypto.CheckResultBlock, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	rows, err := s.db.Query(
		`SELECT height, agent_id, timestamp, checks, hash, signature FROM results WHERE height > ? ORDER BY height ASC LIMIT ?`,
		height, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query results since height %d: %w", height, err)
	}
	defer rows.Close()

	var results []*crypto.CheckResultBlock
	for rows.Next() {
		var block crypto.CheckResultBlock
		var checksStr string
		if err := rows.Scan(&block.Height, &block.AgentID, &block.Timestamp, &checksStr, &block.Hash, &block.Signature); err != nil {
			return nil, fmt.Errorf("scan result row: %w", err)
		}
		block.Checks = json.RawMessage(checksStr)
		results = append(results, &block)
	}

	return results, rows.Err()
}

// GetLatestHeight returns the maximum height in the results table, or 0 if empty.
func (s *Storage) GetLatestHeight() (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var maxHeight sql.NullInt64
	err := s.db.QueryRow("SELECT MAX(height) FROM results").Scan(&maxHeight)
	if err != nil {
		return 0, fmt.Errorf("query latest height: %w", err)
	}
	if !maxHeight.Valid {
		return 0, nil
	}
	return maxHeight.Int64, nil
}

// GetPeerSyncState returns the last synced height for a given peer, or 0 if unknown.
func (s *Storage) GetPeerSyncState(peerID string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var height int64
	err := s.db.QueryRow("SELECT last_height FROM sync_state WHERE peer_id = ?", peerID).Scan(&height)
	if err != nil {
		if err == sql.ErrNoRows {
			return 0, nil
		}
		return 0, fmt.Errorf("query peer sync state for %s: %w", peerID, err)
	}
	return height, nil
}

// SetPeerSyncState updates the last synced height and timestamp for a peer.
func (s *Storage) SetPeerSyncState(peerID string, height int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec(
		`INSERT OR REPLACE INTO sync_state (peer_id, last_height, last_sync) VALUES (?, ?, ?)`,
		peerID, height, time.Now().UTC().Format(time.RFC3339),
	)
	if err != nil {
		return fmt.Errorf("update peer sync state for %s: %w", peerID, err)
	}
	return nil
}

// PruneOlderThan deletes results older than the given number of days.
// Returns the number of deleted rows.
func (s *Storage) PruneOlderThan(days int) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().UTC().AddDate(0, 0, -days).Format(time.RFC3339)
	result, err := s.db.Exec("DELETE FROM results WHERE timestamp < ?", cutoff)
	if err != nil {
		return 0, fmt.Errorf("prune results older than %d days: %w", days, err)
	}

	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("get rows affected: %w", err)
	}

	if deleted > 0 {
		slog.Info("pruned old results", "deleted", deleted, "older_than_days", days)
	}

	return deleted, nil
}

// Close closes the underlying database connection.
func (s *Storage) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.db != nil {
		return s.db.Close()
	}
	return nil
}
