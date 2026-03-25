package events

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"opsboard-agent/internal/incident"
)

// Buffer provides file-based event buffering for reliable delivery.
type Buffer struct {
	dir string
}

// BufferedEvent wraps an incident event with metadata for buffering.
type BufferedEvent struct {
	ID        string         `json:"id"`
	Event     incident.Event `json:"event"`
	CreatedAt time.Time      `json:"createdAt"`
}

// NewBuffer creates a new file-based event buffer.
// It ensures the directory exists.
func NewBuffer(dir string) (*Buffer, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create events directory %s: %w", dir, err)
	}
	return &Buffer{dir: dir}, nil
}

// Write persists an event to disk as a JSON file.
func (b *Buffer) Write(event incident.Event) error {
	id := generateID()
	buffered := BufferedEvent{
		ID:        id,
		Event:     event,
		CreatedAt: time.Now().UTC(),
	}

	data, err := json.MarshalIndent(buffered, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	filename := fmt.Sprintf("%s-%s.json", time.Now().UTC().Format("20060102T150405Z"), id)
	path := filepath.Join(b.dir, filename)

	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("failed to write event file %s: %w", path, err)
	}

	log.Printf("[events] Buffered event %s type=%s target=%s", id, event.Type, event.TargetID)
	return nil
}

// WriteMultiple persists multiple events to disk.
func (b *Buffer) WriteMultiple(events []incident.Event) error {
	for _, event := range events {
		if err := b.Write(event); err != nil {
			return err
		}
	}
	return nil
}

// ReadPending returns all pending (unsent) events from the buffer directory,
// sorted by creation time (oldest first).
func (b *Buffer) ReadPending() ([]BufferedEvent, error) {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read events directory: %w", err)
	}

	var events []BufferedEvent
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		path := filepath.Join(b.dir, entry.Name())
		data, err := os.ReadFile(path)
		if err != nil {
			log.Printf("[events] WARNING: failed to read event file %s: %v", path, err)
			continue
		}

		var buffered BufferedEvent
		if err := json.Unmarshal(data, &buffered); err != nil {
			log.Printf("[events] WARNING: failed to parse event file %s: %v", path, err)
			continue
		}

		events = append(events, buffered)
	}

	// Sort by creation time
	sort.Slice(events, func(i, j int) bool {
		return events[i].CreatedAt.Before(events[j].CreatedAt)
	})

	return events, nil
}

// MarkSent deletes the event file for the given event ID.
func (b *Buffer) MarkSent(eventID string) error {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return fmt.Errorf("failed to read events directory: %w", err)
	}

	for _, entry := range entries {
		if strings.Contains(entry.Name(), eventID) {
			path := filepath.Join(b.dir, entry.Name())
			if err := os.Remove(path); err != nil {
				return fmt.Errorf("failed to delete event file %s: %w", path, err)
			}
			log.Printf("[events] Marked event %s as sent", eventID)
			return nil
		}
	}

	return fmt.Errorf("event file not found for ID %s", eventID)
}

// PendingCount returns the number of pending events.
func (b *Buffer) PendingCount() int {
	entries, err := os.ReadDir(b.dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			count++
		}
	}
	return count
}

// generateID creates a unique ID from timestamp + random bytes.
func generateID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%d-%s", time.Now().UnixNano(), hex.EncodeToString(b))
}
