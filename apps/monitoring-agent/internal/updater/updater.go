package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	githubRepo   = "CPI-Technologies-GmbH/cpi-control"
	checkInterval = 1 * time.Hour
)

// Release represents a GitHub release.
type Release struct {
	TagName string  `json:"tag_name"`
	Assets  []Asset `json:"assets"`
}

// Asset represents a release asset.
type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// Updater checks for and applies agent updates from GitHub releases.
type Updater struct {
	currentVersion string
	binaryPath     string
	stopCh         chan struct{}
	mu             sync.Mutex
}

// New creates an Updater.
func New(currentVersion string) *Updater {
	binaryPath, _ := os.Executable()
	return &Updater{
		currentVersion: currentVersion,
		binaryPath:     binaryPath,
		stopCh:         make(chan struct{}),
	}
}

// Start begins periodic update checks.
func (u *Updater) Start() {
	go u.loop()
}

// Stop halts the update checker.
func (u *Updater) Stop() {
	close(u.stopCh)
}

func (u *Updater) loop() {
	// Check after 5 minutes on startup, then every hour
	timer := time.NewTimer(5 * time.Minute)
	defer timer.Stop()

	for {
		select {
		case <-u.stopCh:
			return
		case <-timer.C:
			u.checkAndUpdate()
			timer.Reset(checkInterval)
		}
	}
}

func (u *Updater) checkAndUpdate() {
	u.mu.Lock()
	defer u.mu.Unlock()

	release, err := u.fetchLatestRelease()
	if err != nil {
		log.Printf("[updater] Failed to check for updates: %v", err)
		return
	}

	latestVersion := strings.TrimPrefix(release.TagName, "v")
	latestVersion = strings.TrimPrefix(latestVersion, "agent-")

	if latestVersion == u.currentVersion || latestVersion == "dev" {
		return
	}

	// Simple version comparison: only update if the versions differ
	// In production, the Version is set via ldflags, so "dev" is skipped
	if u.currentVersion == "dev" {
		log.Printf("[updater] Running dev build, skipping auto-update")
		return
	}

	assetName := u.expectedAssetName()
	var downloadURL string
	for _, asset := range release.Assets {
		if asset.Name == assetName {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}

	if downloadURL == "" {
		log.Printf("[updater] No matching asset %q in release %s", assetName, release.TagName)
		return
	}

	log.Printf("[updater] Update available: %s -> %s, downloading...", u.currentVersion, latestVersion)

	if err := u.downloadAndReplace(downloadURL); err != nil {
		log.Printf("[updater] Failed to apply update: %v", err)
		return
	}

	log.Printf("[updater] Update applied successfully. Restarting...")
	u.restart()
}

func (u *Updater) fetchLatestRelease() (*Release, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/tags/agent-latest", githubRepo)
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		// Fall back to latest tagged release matching "agent-*"
		return u.fetchLatestTaggedRelease()
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var release Release
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

func (u *Updater) fetchLatestTaggedRelease() (*Release, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/releases", githubRepo)
	resp, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned %d", resp.StatusCode)
	}

	var releases []Release
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, err
	}

	for _, r := range releases {
		if strings.HasPrefix(r.TagName, "agent-") {
			return &r, nil
		}
	}
	return nil, fmt.Errorf("no agent release found")
}

func (u *Updater) expectedAssetName() string {
	os := runtime.GOOS
	arch := runtime.GOARCH
	return fmt.Sprintf("opsboard-agent-%s-%s", os, arch)
}

func (u *Updater) downloadAndReplace(downloadURL string) error {
	resp, err := http.Get(downloadURL)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned %d", resp.StatusCode)
	}

	// Write to a temporary file next to the binary
	tmpPath := u.binaryPath + ".new"
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}

	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("failed to write update: %w", err)
	}
	f.Close()

	// Rename old binary as backup
	backupPath := u.binaryPath + ".bak"
	os.Remove(backupPath)
	if err := os.Rename(u.binaryPath, backupPath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to backup current binary: %w", err)
	}

	// Move new binary into place
	if err := os.Rename(tmpPath, u.binaryPath); err != nil {
		// Try to restore backup
		os.Rename(backupPath, u.binaryPath)
		return fmt.Errorf("failed to replace binary: %w", err)
	}

	return nil
}

func (u *Updater) restart() {
	// Re-exec the current process with the same arguments
	argv := os.Args
	env := os.Environ()
	err := syscallExec(u.binaryPath, argv, env)
	if err != nil {
		log.Printf("[updater] Failed to exec new binary: %v", err)
		// If exec fails, the old process continues running
	}
}
