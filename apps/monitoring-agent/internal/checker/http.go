package checker

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"time"

	"opsboard-agent/internal/config"
)

// CheckResult holds the outcome of a single health check.
type CheckResult struct {
	TargetID       string     `json:"targetId"`
	WebsiteID      string     `json:"websiteId"`
	Status         string     `json:"status"` // "up" | "degraded" | "down"
	HTTPStatusCode int        `json:"httpStatusCode"`
	ResponseTimeMs int64      `json:"responseTimeMs"`
	TLSValid       *bool      `json:"tlsValid,omitempty"`
	TLSExpiresAt   *time.Time `json:"tlsExpiresAt,omitempty"`
	ContentMatch   *bool      `json:"contentMatch,omitempty"`
	ErrorMessage   string     `json:"errorMessage,omitempty"`
	CheckedAt      time.Time  `json:"checkedAt"`
}

const (
	StatusUp       = "up"
	StatusDegraded = "degraded"
	StatusDown     = "down"

	// DegradedThresholdMs is the response time threshold above which a check
	// is considered degraded.
	DegradedThresholdMs = 3000
)

// CheckHTTP performs an HTTP health check against the given target.
func CheckHTTP(ctx context.Context, target config.Target) CheckResult {
	result := CheckResult{
		TargetID:  target.ID,
		WebsiteID: target.WebsiteID,
		CheckedAt: time.Now().UTC(),
	}

	timeoutMs := target.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 10000
	}

	// Build HTTP client with timeout
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: time.Duration(timeoutMs) * time.Millisecond,
		}).DialContext,
		TLSHandshakeTimeout: time.Duration(timeoutMs) * time.Millisecond,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: false},
	}

	client := &http.Client{
		Timeout:   time.Duration(timeoutMs) * time.Millisecond,
		Transport: transport,
		// Do not follow redirects automatically; record the status code as-is
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.GetEndpoint(), nil)
	if err != nil {
		result.Status = StatusDown
		result.ErrorMessage = fmt.Sprintf("failed to create request: %v", err)
		return result
	}
	req.Header.Set("User-Agent", "OpsBoard-Agent/1.0")

	start := time.Now()
	resp, err := client.Do(req)
	elapsed := time.Since(start)
	result.ResponseTimeMs = elapsed.Milliseconds()

	if err != nil {
		result.Status = StatusDown
		result.ErrorMessage = fmt.Sprintf("request failed: %v", err)
		log.Printf("[checker] %s (%s) DOWN: %v (%dms)", target.ID, target.GetEndpoint(), err, result.ResponseTimeMs)
		return result
	}
	defer resp.Body.Close()

	result.HTTPStatusCode = resp.StatusCode

	// Check TLS if endpoint is HTTPS
	parsedURL, _ := url.Parse(target.GetEndpoint())
	if parsedURL != nil && parsedURL.Scheme == "https" && resp.TLS != nil {
		tlsResult := CheckTLS(resp.TLS)
		result.TLSValid = &tlsResult.Valid
		if tlsResult.ExpiresAt != nil {
			result.TLSExpiresAt = tlsResult.ExpiresAt
		}
		if !tlsResult.Valid {
			result.ErrorMessage = appendError(result.ErrorMessage, fmt.Sprintf("TLS: %s", tlsResult.Error))
		}
	}

	// Check content pattern
	if target.ExpectedContentPattern != "" {
		bodyBytes, readErr := io.ReadAll(io.LimitReader(resp.Body, 1*1024*1024)) // 1MB limit
		if readErr != nil {
			result.ErrorMessage = appendError(result.ErrorMessage, fmt.Sprintf("failed to read body: %v", readErr))
		} else {
			matched := CheckContent(string(bodyBytes), target.ExpectedContentPattern)
			result.ContentMatch = &matched
			if !matched {
				result.ErrorMessage = appendError(result.ErrorMessage, "content pattern not matched")
			}
		}
	}

	// Determine status
	statusOK := isExpectedStatus(resp.StatusCode, target.ExpectedStatusCodes)
	contentOK := result.ContentMatch == nil || *result.ContentMatch
	tlsOK := result.TLSValid == nil || *result.TLSValid

	if !statusOK || !contentOK || !tlsOK {
		result.Status = StatusDown
		if statusOK && tlsOK && !contentOK {
			// Only content mismatch, still consider it down
			result.Status = StatusDown
		}
	} else if result.ResponseTimeMs > DegradedThresholdMs {
		result.Status = StatusDegraded
	} else {
		result.Status = StatusUp
	}

	log.Printf("[checker] %s (%s) %s: status=%d, time=%dms",
		target.ID, target.GetEndpoint(), result.Status, result.HTTPStatusCode, result.ResponseTimeMs)

	return result
}

// isExpectedStatus checks if the status code is in the expected list.
func isExpectedStatus(code int, expected []int) bool {
	if len(expected) == 0 {
		return code >= 200 && code < 300
	}
	for _, e := range expected {
		if code == e {
			return true
		}
	}
	return false
}

// appendError appends a new error message to an existing one.
func appendError(existing, newMsg string) string {
	if existing == "" {
		return newMsg
	}
	return existing + "; " + newMsg
}
