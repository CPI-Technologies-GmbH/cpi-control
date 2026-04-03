package config

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
)

// Config represents the full agent configuration.
type Config struct {
	AgentID            string        `json:"agentId"`
	Version            string        `json:"version"`
	APIPort            int           `json:"apiPort"`
	APIToken           string        `json:"apiToken"`
	ServerURL          string        `json:"serverUrl"`
	DesktopCallbackURL string        `json:"desktopCallbackUrl"`
	SlackWebhookURL    string        `json:"slackWebhookUrl"`
	CheckDefaults      CheckDefaults `json:"checkDefaults"`
	Targets            []Target      `json:"targets"`
	ConfigHash         string        `json:"configHash"`
}

// CheckDefaults contains default values for health checks.
type CheckDefaults struct {
	TimeoutMs         int `json:"timeoutMs"`
	TimeoutSeconds    int `json:"timeoutSeconds"` // alias, converted to ms
	FailureThreshold  int `json:"failureThreshold"`
	RecoveryThreshold int `json:"recoveryThreshold"`
	CooldownMinutes   int `json:"cooldownMinutes"`
}

// GetTimeoutMs returns effective timeout in milliseconds.
func (c *CheckDefaults) GetTimeoutMs() int {
	if c.TimeoutMs > 0 {
		return c.TimeoutMs
	}
	if c.TimeoutSeconds > 0 {
		return c.TimeoutSeconds * 1000
	}
	return 10000 // default 10s
}

// Target represents a single monitoring target.
type Target struct {
	ID                     string `json:"id"`
	WebsiteID              string `json:"websiteId"`
	WebsiteName            string `json:"websiteName"`
	Endpoint               string `json:"endpoint"`
	URL                    string `json:"url"` // alias for endpoint
	Name                   string `json:"name"`
	Type                   string `json:"type"`
	CheckIntervalSeconds   int    `json:"checkIntervalSeconds"`
	ExpectedStatusCodes    []int  `json:"expectedStatusCodes"`
	ExpectedContentPattern string `json:"expectedContentPattern"`
	TimeoutMs              int    `json:"timeoutMs"`
}

// GetEndpoint returns the effective URL to check (prefers endpoint, falls back to url).
func (t *Target) GetEndpoint() string {
	if t.Endpoint != "" {
		return t.Endpoint
	}
	return t.URL
}

// Manager handles thread-safe access to the configuration.
type Manager struct {
	mu       sync.RWMutex
	config   *Config
	filePath string
	onChange []func(*Config)
}

// NewManager creates a new config manager.
func NewManager(filePath string) *Manager {
	return &Manager{
		filePath: filePath,
		onChange: make([]func(*Config), 0),
	}
}

// Load reads the config from disk and applies it.
func (m *Manager) Load() error {
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		return fmt.Errorf("failed to read config file %s: %w", m.filePath, err)
	}

	cfg, err := parse(data)
	if err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	m.mu.Lock()
	m.config = cfg
	m.mu.Unlock()

	log.Printf("[config] Loaded config with %d targets, hash=%s", len(cfg.Targets), cfg.ConfigHash)
	return nil
}

// Reload re-reads the config from disk and notifies listeners.
func (m *Manager) Reload() error {
	if err := m.Load(); err != nil {
		return err
	}
	m.notifyChange()
	return nil
}

// Apply sets a new config from the provided JSON data and notifies listeners.
func (m *Manager) Apply(data []byte) (*Config, error) {
	cfg, err := parse(data)
	if err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	m.mu.Lock()
	m.config = cfg
	m.mu.Unlock()

	// Persist to disk
	if err := os.WriteFile(m.filePath, data, 0600); err != nil {
		log.Printf("[config] WARNING: failed to persist config to %s: %v", m.filePath, err)
	}

	log.Printf("[config] Applied new config with %d targets, hash=%s", len(cfg.Targets), cfg.ConfigHash)
	m.notifyChange()
	return cfg, nil
}

// Get returns a read-only copy of the current config.
func (m *Manager) Get() *Config {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.config == nil {
		return &Config{}
	}
	// Return a shallow copy to avoid external mutation
	cp := *m.config
	return &cp
}

// OnChange registers a callback that is invoked whenever the config changes.
func (m *Manager) OnChange(fn func(*Config)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onChange = append(m.onChange, fn)
}

func (m *Manager) notifyChange() {
	m.mu.RLock()
	cfg := m.config
	callbacks := make([]func(*Config), len(m.onChange))
	copy(callbacks, m.onChange)
	m.mu.RUnlock()

	for _, fn := range callbacks {
		fn(cfg)
	}
}

// parse parses JSON config data and computes the config hash.
func parse(data []byte) (*Config, error) {
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	// Apply defaults
	if cfg.APIPort == 0 {
		cfg.APIPort = 9111
	}
	if cfg.CheckDefaults.TimeoutMs == 0 {
		cfg.CheckDefaults.TimeoutMs = 10000
	}
	if cfg.CheckDefaults.FailureThreshold == 0 {
		cfg.CheckDefaults.FailureThreshold = 3
	}
	if cfg.CheckDefaults.RecoveryThreshold == 0 {
		cfg.CheckDefaults.RecoveryThreshold = 2
	}
	if cfg.CheckDefaults.CooldownMinutes == 0 {
		cfg.CheckDefaults.CooldownMinutes = 15
	}

	// Apply per-target defaults
	for i := range cfg.Targets {
		if cfg.Targets[i].TimeoutMs == 0 {
			cfg.Targets[i].TimeoutMs = cfg.CheckDefaults.TimeoutMs
		}
		if cfg.Targets[i].CheckIntervalSeconds == 0 {
			cfg.Targets[i].CheckIntervalSeconds = 60
		}
		if len(cfg.Targets[i].ExpectedStatusCodes) == 0 {
			cfg.Targets[i].ExpectedStatusCodes = []int{200}
		}
	}

	// Compute config hash (excluding the hash field itself)
	cfg.ConfigHash = ""
	hashData, _ := json.Marshal(cfg)
	hash := sha256.Sum256(hashData)
	cfg.ConfigHash = fmt.Sprintf("%x", hash[:8])

	return &cfg, nil
}
