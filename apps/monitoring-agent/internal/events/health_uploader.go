package events

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"opsboard-agent/internal/checker"
	"opsboard-agent/internal/config"
)

// HealthEventPayload is the JSON body expected by POST /api/webhooks/health-event.
type HealthEventPayload struct {
	AgentID            string                 `json:"agentId"`
	ServiceID          string                 `json:"serviceId"`
	MonitoringTargetID string                 `json:"monitoringTargetId,omitempty"`
	Status             string                 `json:"status"`
	StatusCode         int                    `json:"statusCode,omitempty"`
	ResponseTimeMs     int64                  `json:"responseTimeMs,omitempty"`
	ErrorMessage       string                 `json:"errorMessage,omitempty"`
	CheckedAt          string                 `json:"checkedAt"`
	Metadata           map[string]interface{} `json:"metadata,omitempty"`
}

// HealthResultUploader periodically reads pending health results and uploads them
// to the backend server.
type HealthResultUploader struct {
	buffer   *HealthResultBuffer
	cfgMgr   *config.Manager
	client   *http.Client
	interval time.Duration
}

// NewHealthResultUploader creates a new health result uploader.
func NewHealthResultUploader(buffer *HealthResultBuffer, cfgMgr *config.Manager) *HealthResultUploader {
	return &HealthResultUploader{
		buffer: buffer,
		cfgMgr: cfgMgr,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		interval: 10 * time.Second,
	}
}

// Run starts the health result uploader loop. It blocks until the context is cancelled.
func (u *HealthResultUploader) Run(ctx context.Context) {
	log.Printf("[health-uploader] Starting health result uploader (interval=%s)", u.interval)
	ticker := time.NewTicker(u.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("[health-uploader] Shutting down")
			u.uploadPending()
			return
		case <-ticker.C:
			u.uploadPending()
		}
	}
}

func (u *HealthResultUploader) uploadPending() {
	pending, err := u.buffer.ReadPending()
	if err != nil {
		log.Printf("[health-uploader] Failed to read pending results: %v", err)
		return
	}

	if len(pending) == 0 {
		return
	}

	cfg := u.cfgMgr.Get()
	if cfg.ServerURL == "" {
		return
	}

	sent := 0
	for _, p := range pending {
		if err := u.sendResult(cfg.ServerURL, cfg.APIToken, cfg.AgentID, p.Result); err != nil {
			log.Printf("[health-uploader] Failed to upload result for target %s: %v (will retry)", p.Result.TargetID, err)
			// Stop on first failure to preserve order and avoid flooding
			break
		}

		if err := u.buffer.MarkSent(p.ID); err != nil {
			log.Printf("[health-uploader] Failed to mark result %s as sent: %v", p.ID, err)
		}
		sent++
	}

	if sent > 0 {
		log.Printf("[health-uploader] Uploaded %d/%d buffered health results", sent, len(pending))
	}
}

func (u *HealthResultUploader) sendResult(serverURL, apiToken, agentID string, result checker.CheckResult) error {
	url := strings.TrimRight(serverURL, "/") + "/api/webhooks/health-event"

	// Map agent status values to backend status values
	status := mapStatus(result.Status)

	payload := HealthEventPayload{
		AgentID:            agentID,
		ServiceID:          result.WebsiteID,
		MonitoringTargetID: result.TargetID,
		Status:             status,
		StatusCode:         result.HTTPStatusCode,
		ResponseTimeMs:     result.ResponseTimeMs,
		ErrorMessage:       result.ErrorMessage,
		CheckedAt:          result.CheckedAt.Format(time.RFC3339),
		Metadata: map[string]interface{}{
			"source": "monitoring-agent",
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal health event: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
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
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	return nil
}

// SendResultDirect attempts to send a health check result directly to the backend.
// Returns an error if the backend is unreachable.
func SendResultDirect(client *http.Client, serverURL, apiToken, agentID string, result checker.CheckResult) error {
	url := strings.TrimRight(serverURL, "/") + "/api/webhooks/health-event"

	status := mapStatus(result.Status)

	payload := HealthEventPayload{
		AgentID:            agentID,
		ServiceID:          result.WebsiteID,
		MonitoringTargetID: result.TargetID,
		Status:             status,
		StatusCode:         result.HTTPStatusCode,
		ResponseTimeMs:     result.ResponseTimeMs,
		ErrorMessage:       result.ErrorMessage,
		CheckedAt:          result.CheckedAt.Format(time.RFC3339),
		Metadata: map[string]interface{}{
			"source": "monitoring-agent",
		},
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal health event: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if apiToken != "" {
		req.Header.Set("Authorization", "Bearer "+apiToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("server returned status %d", resp.StatusCode)
	}

	return nil
}

// mapStatus converts agent status values ("up"/"degraded"/"down") to
// backend-expected values ("healthy"/"degraded"/"down").
func mapStatus(agentStatus string) string {
	switch agentStatus {
	case "up":
		return "healthy"
	case "degraded":
		return "degraded"
	case "down":
		return "down"
	default:
		return agentStatus
	}
}
