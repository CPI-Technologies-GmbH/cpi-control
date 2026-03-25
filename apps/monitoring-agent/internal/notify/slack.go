package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

// SlackNotifier sends notifications to Slack via webhook.
type SlackNotifier struct {
	webhookURL string
	client     *http.Client
}

// SlackMessage represents a Slack Block Kit message payload.
type SlackMessage struct {
	Text   string       `json:"text"`
	Blocks []SlackBlock `json:"blocks"`
}

// SlackBlock represents a single Slack block.
type SlackBlock struct {
	Type     string          `json:"type"`
	Text     *SlackText      `json:"text,omitempty"`
	Elements []SlackElement  `json:"elements,omitempty"`
	Fields   []SlackText     `json:"fields,omitempty"`
}

// SlackText represents a Slack text object.
type SlackText struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Emoji bool   `json:"emoji,omitempty"`
}

// SlackElement represents an element within a block.
type SlackElement struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// NewSlackNotifier creates a new Slack webhook notifier.
func NewSlackNotifier(webhookURL string) *SlackNotifier {
	return &SlackNotifier{
		webhookURL: webhookURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SetWebhookURL updates the webhook URL (used when config is reloaded).
func (s *SlackNotifier) SetWebhookURL(url string) {
	s.webhookURL = url
}

// SendMessage sends a Slack message payload to the webhook.
func (s *SlackNotifier) SendMessage(msg SlackMessage) error {
	if s.webhookURL == "" {
		log.Printf("[slack] No webhook URL configured, skipping notification")
		return nil
	}

	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal slack message: %w", err)
	}

	resp, err := s.client.Post(s.webhookURL, "application/json", bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("failed to send slack message: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slack webhook returned status %d", resp.StatusCode)
	}

	log.Printf("[slack] Notification sent successfully")
	return nil
}

// BuildDownMessage creates a Slack Block Kit message for a website going down.
func BuildDownMessage(websiteName, endpoint, errorMsg string, timestamp time.Time) SlackMessage {
	fallbackText := fmt.Sprintf("[DOWN] %s is down", websiteName)

	return SlackMessage{
		Text: fallbackText,
		Blocks: []SlackBlock{
			{
				Type: "header",
				Text: &SlackText{
					Type:  "plain_text",
					Text:  fmt.Sprintf("🔴 %s is DOWN", websiteName),
					Emoji: true,
				},
			},
			{
				Type: "section",
				Fields: []SlackText{
					{
						Type: "mrkdwn",
						Text: fmt.Sprintf("*Endpoint:*\n%s", endpoint),
					},
					{
						Type: "mrkdwn",
						Text: fmt.Sprintf("*Detected At:*\n%s", timestamp.Format(time.RFC3339)),
					},
				},
			},
			{
				Type: "section",
				Text: &SlackText{
					Type: "mrkdwn",
					Text: fmt.Sprintf("*Error:*\n```%s```", errorMsg),
				},
			},
			{
				Type: "context",
				Elements: []SlackElement{
					{
						Type: "mrkdwn",
						Text: "Sent by OpsBoard Monitoring Agent",
					},
				},
			},
		},
	}
}

// BuildRecoveryMessage creates a Slack Block Kit message for a website recovering.
func BuildRecoveryMessage(websiteName, endpoint string, downSince, recoveredAt time.Time) SlackMessage {
	duration := recoveredAt.Sub(downSince).Round(time.Second)
	fallbackText := fmt.Sprintf("[RECOVERED] %s is back up", websiteName)

	return SlackMessage{
		Text: fallbackText,
		Blocks: []SlackBlock{
			{
				Type: "header",
				Text: &SlackText{
					Type:  "plain_text",
					Text:  fmt.Sprintf("🟢 %s is RECOVERED", websiteName),
					Emoji: true,
				},
			},
			{
				Type: "section",
				Fields: []SlackText{
					{
						Type: "mrkdwn",
						Text: fmt.Sprintf("*Endpoint:*\n%s", endpoint),
					},
					{
						Type: "mrkdwn",
						Text: fmt.Sprintf("*Recovered At:*\n%s", recoveredAt.Format(time.RFC3339)),
					},
				},
			},
			{
				Type: "section",
				Text: &SlackText{
					Type: "mrkdwn",
					Text: fmt.Sprintf("*Downtime Duration:*\n%s", duration.String()),
				},
			},
			{
				Type: "context",
				Elements: []SlackElement{
					{
						Type: "mrkdwn",
						Text: "Sent by OpsBoard Monitoring Agent",
					},
				},
			},
		},
	}
}
