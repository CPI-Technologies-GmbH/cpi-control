package events

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"opsboard-agent/internal/config"
	"opsboard-agent/internal/incident"
)

// BatchPayload is the JSON payload sent to the desktop callback URL.
type BatchPayload struct {
	AgentID    string           `json:"agentId"`
	ConfigHash string          `json:"configHash"`
	Events     []incident.Event `json:"events"`
	EventIDs   []string         `json:"eventIds"`
	SentAt     time.Time        `json:"sentAt"`
}

// Uploader periodically reads pending events and uploads them to the desktop app.
type Uploader struct {
	buffer   *Buffer
	cfgMgr   *config.Manager
	client   *http.Client
	interval time.Duration
}

// NewUploader creates a new event uploader.
func NewUploader(buffer *Buffer, cfgMgr *config.Manager) *Uploader {
	return &Uploader{
		buffer: buffer,
		cfgMgr: cfgMgr,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		interval: 10 * time.Second,
	}
}

// Run starts the uploader loop. It blocks until the context is cancelled.
func (u *Uploader) Run(ctx context.Context) {
	log.Printf("[uploader] Starting event uploader (interval=%s)", u.interval)
	ticker := time.NewTicker(u.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[uploader] Shutting down event uploader")
			// Do one final upload attempt
			u.uploadPending()
			return
		case <-ticker.C:
			u.uploadPending()
		}
	}
}

func (u *Uploader) uploadPending() {
	pending, err := u.buffer.ReadPending()
	if err != nil {
		log.Printf("[uploader] Failed to read pending events: %v", err)
		return
	}

	if len(pending) == 0 {
		return
	}

	cfg := u.cfgMgr.Get()
	if cfg.DesktopCallbackURL == "" {
		// No callback URL configured; events stay buffered
		return
	}

	// Build batch payload
	events := make([]incident.Event, len(pending))
	eventIDs := make([]string, len(pending))
	for i, p := range pending {
		events[i] = p.Event
		eventIDs[i] = p.ID
	}

	payload := BatchPayload{
		AgentID:    cfg.AgentID,
		ConfigHash: cfg.ConfigHash,
		Events:     events,
		EventIDs:   eventIDs,
		SentAt:     time.Now().UTC(),
	}

	if err := u.sendBatch(cfg.DesktopCallbackURL, cfg.APIToken, payload); err != nil {
		log.Printf("[uploader] Failed to upload %d events: %v (will retry)", len(pending), err)
		return
	}

	// Mark all sent events
	for _, id := range eventIDs {
		if err := u.buffer.MarkSent(id); err != nil {
			log.Printf("[uploader] Failed to mark event %s as sent: %v", id, err)
		}
	}

	log.Printf("[uploader] Successfully uploaded %d events", len(pending))
}

func (u *Uploader) sendBatch(callbackURL, apiToken string, payload BatchPayload) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal batch payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, callbackURL, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiToken != "" {
		req.Header.Set("Authorization", "Bearer "+apiToken)
	}

	resp, err := u.client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("callback returned status %d", resp.StatusCode)
	}

	return nil
}
