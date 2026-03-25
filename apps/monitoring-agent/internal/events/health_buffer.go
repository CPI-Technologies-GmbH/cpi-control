package events

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"opsboard-agent/internal/checker"
)

// HealthResultBuffer provides file-based buffering for health check results.
// This ensures results are not lost if the backend is unreachable.
type HealthResultBuffer struct {
	dir string
}

// BufferedHealthResult wraps a health check result with metadata for buffering.
type BufferedHealthResult struct {
	ID        string             `json:"id"`
	Result    checker.CheckResult `json:"result"`
	CreatedAt time.Time          `json:"createdAt"`
}

// NewHealthResultBuffer creates a new file-based health result buffer.
func NewHealthResultBuffer(dir string) (*HealthResultBuffer, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create health results directory %s: %w", dir, err)
	}
	return &HealthResultBuffer{dir: dir}, nil
}

// Write persists a health check result to disk as a JSON file.
func (b *HealthResultBuffer) Write(result checker.CheckResult) error {
	id := generateID()
	buffered := BufferedHealthResult{
		ID:        id,
		Result:    result,
		CreatedAt: time.Now().UTC(),
	}

	data, err := json.MarshalIndent(buffered, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal health result: %w", err)
	}

	filename := fmt.Sprintf("health-%s-%s.json", time.Now().UTC().Format("20060102T150405Z"), id)
	path := filepath.Join(b.dir, filename)

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write health result file %s: %w", path, err)
	}

	return nil
}

// ReadPending returns all pending (unsent) health results from the buffer directory,
// sorted by creation time (oldest first).
func (b *HealthResultBuffer) ReadPending() ([]BufferedHealthResult, error) {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read health results directory: %w", err)
	}

	var results []BufferedHealthResult
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "health-") || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		path := filepath.Join(b.dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("[health-buffer] WARNING: failed to read file %s: %v", path, err)
			continue
		}

		var buffered BufferedHealthResult
		if err := json.Unmarshal(data, &buffered); err != nil {
			log.Printf("[health-buffer] WARNING: failed to parse file %s: %v", path, err)
			continue
		}

		results = append(results, buffered)
	}

	// Sort by creation time
	sort.Slice(results, func(i, j int) bool {
		return results[i].CreatedAt.Before(results[j].CreatedAt)
	})

	return results, nil
}

// MarkSent deletes the health result file for the given ID.
func (b *HealthResultBuffer) MarkSent(resultID string) error {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return fmt.Errorf("failed to read health results directory: %w", err)
	}

	for _, entry := range entries {
		if strings.Contains(entry.Name(), resultID) {
			path := filepath.Join(b.dir, entry.Name())
			if err := os.Remove(path); err != nil {
				return fmt.Errorf("failed to delete health result file %s: %w", path, err)
			}
			return nil
		}
	}

	return fmt.Errorf("health result file not found for ID %s", resultID)
}

// PendingCount returns the number of pending health results.
func (b *HealthResultBuffer) PendingCount() int {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasPrefix(entry.Name(), "health-") && strings.HasSuffix(entry.Name(), ".json") {
			count++
		}
	}
	return count
}
