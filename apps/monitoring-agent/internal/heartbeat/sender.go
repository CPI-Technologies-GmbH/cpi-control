package heartbeat

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

// heartbeatPayload is the JSON body sent to the server.
type heartbeatPayload struct {
	AgentID string                 `json:"agentId"`
	Version string                 `json:"version"`
	Metrics map[string]interface{} `json:"metrics"`
}

// Sender periodically sends heartbeats to the opsboard backend.
type Sender struct {
	serverURL string
	agentID   string
	token     string
	version   string
	interval  time.Duration
	client    *http.Client
	stopCh    chan struct{}
}

// New creates a new heartbeat Sender.
func New(serverURL, agentID, token, version string, interval time.Duration) *Sender {
	return &Sender{
		serverURL: strings.TrimRight(serverURL, "/"),
		agentID:   agentID,
		token:     token,
		version:   version,
		interval:  interval,
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		stopCh: make(chan struct{}),
	}
}

// Start begins sending heartbeats in a background goroutine.
func (s *Sender) Start() {
	go s.run()
	log.Printf("[heartbeat] Started heartbeat sender (interval=%s, server=%s)", s.interval, s.serverURL)
}

// Stop signals the heartbeat goroutine to stop.
func (s *Sender) Stop() {
	close(s.stopCh)
	log.Printf("[heartbeat] Stopped heartbeat sender")
}

func (s *Sender) run() {
	// Send an initial heartbeat immediately on startup
	if err := s.sendHeartbeat(); err != nil {
		log.Printf("[heartbeat] Initial heartbeat failed: %v", err)
	}

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			if err := s.sendHeartbeat(); err != nil {
				log.Printf("[heartbeat] Failed to send heartbeat: %v (will retry next interval)", err)
			}
		}
	}
}

func (s *Sender) sendHeartbeat() error {
	url := s.serverURL + "/api/webhooks/agent-heartbeat"

	payload := heartbeatPayload{
		AgentID: s.agentID,
		Version: s.version,
		Metrics: map[string]interface{}{},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal heartbeat payload: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create heartbeat request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("heartbeat request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("heartbeat returned status %d", resp.StatusCode)
	}

	return nil
}
