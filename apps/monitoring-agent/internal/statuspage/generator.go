package statuspage

import (
	"bytes"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"math"
	"os"
	"strings"
	"time"

	"opsboard-agent/internal/crypto"
	agentsync "opsboard-agent/internal/sync"
)

//go:embed templates/*.html
var templateFS embed.FS

// PageData holds all data needed to render a status page.
type PageData struct {
	CompanyName  string
	LogoURL      string
	PrimaryColor string
	Theme        string
	Projects     []ProjectData
	GeneratedAt  string
}

// ProjectData holds aggregated project-level status for rendering.
type ProjectData struct {
	Name          string
	Description   string
	Services      []ServiceData
	OverallStatus string // operational, degraded, down
}

// ServiceData holds individual service status for rendering.
type ServiceData struct {
	Name           string
	Description    string
	Status         string  // operational, degraded, down, maintenance
	UptimePercent  float64 // 30 days
	Uptime7d       float64
	Uptime24h      float64
	ResponseTimeMs *int    // nil if not shown
	LastChecked    string
	DayHistory     []DayStatus
	HistoryLabel   string // "48 hours", "7 days", "14 days", "90 days"
}

// DayStatus represents the status of a service for a single day.
type DayStatus struct {
	Date   string
	Status string // operational, degraded, down, unknown
}

// checkRecord is an internal type for deserializing stored check results.
type checkRecord struct {
	TargetID       string `json:"targetId"`
	WebsiteID      string `json:"websiteId"`
	Status         string `json:"status"`
	ResponseTimeMs int64  `json:"responseTimeMs"`
	CheckedAt      string `json:"checkedAt"`
}

// checkEntry is an internal type for processed check data used in uptime calculations.
type checkEntry struct {
	status         string
	responseTimeMs int64
	checkedAt      time.Time
}

// GeneratePage renders the HTML for a single status page configuration.
func GeneratePage(page *PageConfig, storage *agentsync.Storage) ([]byte, error) {
	templateName := "dark.html"
	switch page.Theme {
	case "light":
		templateName = "light.html"
	case "minimal":
		templateName = "minimal.html"
	}

	tmpl, err := template.New(templateName).Funcs(templateFuncs()).ParseFS(templateFS, "templates/"+templateName)
	if err != nil {
		return nil, fmt.Errorf("parse template %s: %w", templateName, err)
	}

	pageData, err := buildPageData(page, storage)
	if err != nil {
		return nil, fmt.Errorf("build page data: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, pageData); err != nil {
		return nil, fmt.Errorf("execute template: %w", err)
	}

	return buf.Bytes(), nil
}

func templateFuncs() template.FuncMap {
	return template.FuncMap{
		"safeURL": func(s string) template.URL {
			return template.URL(s)
		},
		"statusColor": func(status string) string {
			switch status {
			case "operational":
				return "#10b981"
			case "degraded":
				return "#f59e0b"
			case "down":
				return "#ef4444"
			case "maintenance":
				return "#6366f1"
			default:
				return "#6b7280"
			}
		},
		"statusLabel": func(status string) string {
			switch status {
			case "operational":
				return "Operational"
			case "degraded":
				return "Degraded"
			case "down":
				return "Down"
			case "maintenance":
				return "Maintenance"
			default:
				return "Unknown"
			}
		},
		"formatUptime": func(pct float64) string {
			return fmt.Sprintf("%.2f%%", pct)
		},
		"notNil": func(v *int) bool {
			return v != nil
		},
		"deref": func(v *int) int {
			if v == nil {
				return 0
			}
			return *v
		},
	}
}

func buildPageData(page *PageConfig, storage *agentsync.Storage) (*PageData, error) {
	// Fetch last 90 days of results
	sinceHeight := int64(0)
	allResults, err := storage.GetResultsSince(sinceHeight, 100000)
	if err != nil {
		slog.Warn("failed to fetch results for status page", "error", err)
		allResults = []*crypto.CheckResultBlock{}
	}

	// Parse all checks into a flat list keyed by service ID
	serviceChecks := make(map[string][]checkEntry)

	for _, block := range allResults {
		var checks []checkRecord
		if err := json.Unmarshal(block.Checks, &checks); err != nil {
			// Try single check
			var single checkRecord
			if err2 := json.Unmarshal(block.Checks, &single); err2 == nil {
				checks = []checkRecord{single}
			} else {
				continue
			}
		}
		for _, c := range checks {
			key := c.WebsiteID
			if key == "" {
				key = c.TargetID
			}
			t, _ := time.Parse(time.RFC3339, c.CheckedAt)
			if t.IsZero() {
				t, _ = time.Parse(time.RFC3339, block.Timestamp)
			}
			serviceChecks[key] = append(serviceChecks[key], checkEntry{
				status:         c.Status,
				responseTimeMs: c.ResponseTimeMs,
				checkedAt:      t,
			})
		}
	}

	now := time.Now().UTC()
	projects := make([]ProjectData, 0, len(page.Projects))

	for _, projCfg := range page.Projects {
		proj := ProjectData{
			Name:        projCfg.PublicName,
			Description: projCfg.PublicDescription,
		}

		worstStatus := "operational"

		for _, svcCfg := range projCfg.Services {
			svcData := buildServiceData(svcCfg, serviceChecks[svcCfg.ServiceID], now)
			proj.Services = append(proj.Services, svcData)

			if statusWorse(svcData.Status, worstStatus) {
				worstStatus = svcData.Status
			}
		}

		proj.OverallStatus = worstStatus
		projects = append(projects, proj)
	}

	primaryColor := page.Branding.PrimaryColor
	if primaryColor == "" {
		primaryColor = "#3b82f6"
	}

	// Resolve logo: if it's a local file path, read and convert to data URI
	logoURL := page.Branding.LogoURL
	if logoURL != "" && !strings.HasPrefix(logoURL, "data:") && !strings.HasPrefix(logoURL, "http") {
		if data, err := os.ReadFile(logoURL); err == nil {
			mimeType := "image/png"
			switch {
			case strings.HasSuffix(logoURL, ".svg"):
				mimeType = "image/svg+xml"
			case strings.HasSuffix(logoURL, ".jpg"), strings.HasSuffix(logoURL, ".jpeg"):
				mimeType = "image/jpeg"
			case strings.HasSuffix(logoURL, ".webp"):
				mimeType = "image/webp"
			}
			logoURL = fmt.Sprintf("data:%s;base64,%s", mimeType, base64.StdEncoding.EncodeToString(data))
		} else {
			slog.Warn("failed to read logo file", "path", logoURL, "error", err)
			logoURL = ""
		}
	}

	return &PageData{
		CompanyName:  page.Branding.CompanyName,
		LogoURL:      logoURL,
		PrimaryColor: primaryColor,
		Theme:        page.Theme,
		Projects:     projects,
		GeneratedAt:  now.Format(time.RFC3339),
	}, nil
}

func buildServiceData(cfg ServiceConfig, checks []checkEntry, now time.Time) ServiceData {
	sd := ServiceData{
		Name:        cfg.PublicName,
		Description: cfg.PublicDescription,
		Status:      "unknown",
	}

	if len(checks) == 0 {
		sd.UptimePercent = 100
		sd.Uptime7d = 100
		sd.Uptime24h = 100
		sd.DayHistory = buildEmptyHistory(now, 48)
		sd.HistoryLabel = "48 hours"
		return sd
	}

	// Calculate uptimes
	sd.Uptime24h = calcUptime(checks, now, 24*time.Hour)
	sd.Uptime7d = calcUptime(checks, now, 7*24*time.Hour)
	sd.UptimePercent = calcUptime(checks, now, 30*24*time.Hour)

	// Current status from most recent check
	var latest checkEntry
	for _, c := range checks {
		if c.checkedAt.After(latest.checkedAt) {
			latest = c
		}
	}
	sd.Status = mapStatus(latest.status)
	sd.LastChecked = latest.checkedAt.Format(time.RFC3339)

	if cfg.ShowResponseTime {
		ms := int(latest.responseTimeMs)
		sd.ResponseTimeMs = &ms
	}

	// Build adaptive history: choose interval based on how long we have data
	// < 2 days: hourly bars (up to 48)
	// < 7 days: 6h bars
	// < 14 days: 12h bars
	// >= 14 days: daily bars (up to 90)
	oldestCheck := now
	for _, c := range checks {
		if !c.checkedAt.IsZero() && c.checkedAt.Before(oldestCheck) {
			oldestCheck = c.checkedAt
		}
	}
	dataAge := now.Sub(oldestCheck)

	if dataAge < 2*24*time.Hour {
		sd.DayHistory = buildIntervalHistory(checks, now, time.Hour, 48)
		sd.HistoryLabel = "48 hours"
	} else if dataAge < 7*24*time.Hour {
		sd.DayHistory = buildIntervalHistory(checks, now, 6*time.Hour, 28)
		sd.HistoryLabel = "7 days"
	} else if dataAge < 14*24*time.Hour {
		sd.DayHistory = buildIntervalHistory(checks, now, 12*time.Hour, 28)
		sd.HistoryLabel = "14 days"
	} else {
		sd.DayHistory = buildDayHistory(checks, now, 90)
		sd.HistoryLabel = "90 days"
	}

	return sd
}

func calcUptime(checks []checkEntry, now time.Time, window time.Duration) float64 {
	cutoff := now.Add(-window)
	total := 0
	up := 0
	for _, c := range checks {
		if c.checkedAt.Before(cutoff) {
			continue
		}
		total++
		if c.status == "up" || c.status == "healthy" || c.status == "degraded" {
			up++
		}
	}
	if total == 0 {
		return 100.0
	}
	return math.Round(float64(up)/float64(total)*10000) / 100
}

func buildDayHistory(checks []checkEntry, now time.Time, days int) []DayStatus {
	history := make([]DayStatus, days)
	// Index checks by day
	dayMap := make(map[string][]string) // date -> statuses
	for _, c := range checks {
		day := c.checkedAt.Format("2006-01-02")
		dayMap[day] = append(dayMap[day], c.status)
	}

	for i := 0; i < days; i++ {
		d := now.AddDate(0, 0, -(days-1-i))
		dateStr := d.Format("2006-01-02")
		statuses, ok := dayMap[dateStr]
		if !ok {
			history[i] = DayStatus{Date: dateStr, Status: "unknown"}
			continue
		}

		// Determine worst status for the day
		worst := "operational"
		for _, s := range statuses {
			mapped := mapStatus(s)
			if statusWorse(mapped, worst) {
				worst = mapped
			}
		}
		history[i] = DayStatus{Date: dateStr, Status: worst}
	}
	return history
}

func buildEmptyHistory(now time.Time, days int) []DayStatus {
	history := make([]DayStatus, days)
	for i := 0; i < days; i++ {
		d := now.AddDate(0, 0, -(days-1-i))
		history[i] = DayStatus{Date: d.Format("2006-01-02"), Status: "unknown"}
	}
	return history
}

func buildIntervalHistory(checks []checkEntry, now time.Time, interval time.Duration, bars int) []DayStatus {
	history := make([]DayStatus, bars)
	for i := 0; i < bars; i++ {
		slotEnd := now.Add(-time.Duration(bars-1-i) * interval)
		slotStart := slotEnd.Add(-interval)
		dateStr := slotEnd.Format("2006-01-02 15:04")

		worst := "unknown"
		hasChecks := false
		for _, c := range checks {
			if c.checkedAt.After(slotStart) && !c.checkedAt.After(slotEnd) {
				hasChecks = true
				mapped := mapStatus(c.status)
				if worst == "unknown" || statusWorse(mapped, worst) {
					worst = mapped
				}
			}
		}
		if !hasChecks {
			worst = "unknown"
		}
		history[i] = DayStatus{Date: dateStr, Status: worst}
	}
	return history
}

func mapStatus(s string) string {
	switch s {
	case "up", "healthy":
		return "operational"
	case "degraded":
		return "degraded"
	case "down":
		return "down"
	default:
		return "unknown"
	}
}

func statusWorse(a, b string) bool {
	rank := map[string]int{
		"operational": 0,
		"unknown":     1,
		"degraded":    2,
		"maintenance": 3,
		"down":        4,
	}
	return rank[a] > rank[b]
}
