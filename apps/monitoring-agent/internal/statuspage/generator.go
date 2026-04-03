package statuspage

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"log/slog"
	"math"
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

	return &PageData{
		CompanyName:  page.Branding.CompanyName,
		LogoURL:      page.Branding.LogoURL,
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
		sd.DayHistory = buildEmptyHistory(now, 90)
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

	// Build 90-day history
	sd.DayHistory = buildDayHistory(checks, now, 90)

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
		if c.status == "up" || c.status == "degraded" {
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

func mapStatus(s string) string {
	switch s {
	case "up":
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
