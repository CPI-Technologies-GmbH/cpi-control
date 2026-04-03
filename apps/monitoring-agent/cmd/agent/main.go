package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"opsboard-agent/internal/api"
	"opsboard-agent/internal/config"
	"opsboard-agent/internal/crypto"
	"opsboard-agent/internal/events"
	"opsboard-agent/internal/heartbeat"
	"opsboard-agent/internal/incident"
	"opsboard-agent/internal/notify"
	"opsboard-agent/internal/scheduler"
	"opsboard-agent/internal/statuspage"
	agentsync "opsboard-agent/internal/sync"
	"opsboard-agent/internal/updater"
)

// Version is set by ldflags at build time.
var Version = "dev"

const (
	defaultConfigPath      = "/etc/opsboard-agent/config.json"
	defaultEventsDir       = "/var/lib/opsboard-agent/events"
	defaultHealthResultDir = "/var/lib/opsboard-agent/health-results"
	defaultKeyDir          = "/opt/opsboard-agent"
	defaultDBPath          = "/var/lib/opsboard-agent/sync.db"
	defaultCertDir         = "/var/lib/opsboard-agent/certs"
	defaultSyncPort        = 9112
	defaultPruneIntervalH  = 6
	defaultRetentionDays   = 90
	defaultSyncIntervalS   = 60
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[opsboard-agent] ")
	log.Printf("Starting OpsBoard Monitoring Agent v%s", Version)

	// Determine config path
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = defaultConfigPath
	}
	log.Printf("Loading config from %s", configPath)

	// Determine events directory
	eventsDir := os.Getenv("EVENTS_DIR")
	if eventsDir == "" {
		eventsDir = defaultEventsDir
	}

	// Determine health results directory
	healthResultDir := os.Getenv("HEALTH_RESULT_DIR")
	if healthResultDir == "" {
		healthResultDir = defaultHealthResultDir
	}

	// Determine key directory
	keyDir := os.Getenv("AGENT_KEY_DIR")
	if keyDir == "" {
		keyDir = defaultKeyDir
	}

	// Determine database path
	dbPath := os.Getenv("AGENT_DB_PATH")
	if dbPath == "" {
		dbPath = defaultDBPath
	}

	// Determine cert directory
	certDir := os.Getenv("AGENT_CERT_DIR")
	if certDir == "" {
		certDir = defaultCertDir
	}

	// Load configuration
	cfgMgr := config.NewManager(configPath)
	if err := cfgMgr.Load(); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	cfg := cfgMgr.Get()

	// ---- Phase 1: Crypto key management ----
	keyPair, err := initKeyPair(keyDir)
	if err != nil {
		log.Fatalf("Failed to initialize key pair: %v", err)
	}
	log.Printf("Agent public key: %s", crypto.PublicKeyToBase64(keyPair.PublicKey))

	keyStore := crypto.NewKeyStore(keyDir)

	// ---- Phase 2: Height-based storage (SQLite) ----
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		log.Fatalf("Failed to create database directory: %v", err)
	}
	storage, err := agentsync.NewStorage(dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize sync storage: %v", err)
	}
	defer storage.Close()

	// Initialize event buffer
	buffer, err := events.NewBuffer(eventsDir)
	if err != nil {
		log.Fatalf("Failed to initialize event buffer: %v", err)
	}

	// Initialize health result buffer for offline resilience
	healthBuffer, err := events.NewHealthResultBuffer(healthResultDir)
	if err != nil {
		log.Fatalf("Failed to initialize health result buffer: %v", err)
	}

	// Initialize incident detector
	detector := incident.NewDetector(cfg)

	// Initialize Slack notifier
	slackNotifier := notify.NewSlackNotifier(cfg.SlackWebhookURL)

	// Initialize scheduler
	sched := scheduler.NewScheduler(cfgMgr, detector, buffer, healthBuffer, slackNotifier)

	// Set up result storage callback: store each check result in sync storage
	sched.SetResultCallback(func(resultJSON []byte) {
		storeCheckResult(storage, keyPair, cfg.AgentID, resultJSON)
	})

	// Register config change callbacks
	cfgMgr.OnChange(func(newCfg *config.Config) {
		detector.UpdateConfig(newCfg)
		slackNotifier.SetWebhookURL(newCfg.SlackWebhookURL)
		sched.Reconfigure(newCfg)
	})

	// Start scheduler
	if err := sched.Start(); err != nil {
		log.Fatalf("Failed to start scheduler: %v", err)
	}

	// Start event uploader
	uploaderCtx, uploaderCancel := context.WithCancel(context.Background())
	uploader := events.NewUploader(buffer, cfgMgr)
	go uploader.Run(uploaderCtx)

	// Start health result uploader (retries buffered results)
	healthUploaderCtx, healthUploaderCancel := context.WithCancel(context.Background())
	healthUploader := events.NewHealthResultUploader(healthBuffer, cfgMgr)
	go healthUploader.Run(healthUploaderCtx)

	// Start HTTP API server
	apiServer := api.NewServer(cfgMgr, sched, buffer, Version)
	apiAddr := fmt.Sprintf(":%d", cfg.APIPort)

	go func() {
		if err := apiServer.ListenAndServe(apiAddr); err != nil {
			log.Printf("API server error: %v", err)
		}
	}()

	// ---- Phase 3: Peer sync ----
	// Start sync server on separate port
	syncServer := agentsync.NewSyncServer(storage, keyPair, keyStore, cfg.AgentID)
	syncAddr := fmt.Sprintf(":%d", defaultSyncPort)
	go func() {
		if err := syncServer.ListenAndServe(syncAddr); err != nil {
			slog.Error("sync server error", "error", err)
		}
	}()

	// Start sync client for periodic peer sync
	syncClient := agentsync.NewSyncClient(storage, keyStore)
	syncClient.StartPeriodicSync(time.Duration(defaultSyncIntervalS) * time.Second)

	// ---- Phase 4: Status page server ----
	var statusPageServer *statuspage.Server
	spConfigPath := os.Getenv("STATUSPAGE_CONFIG")
	if spConfigPath == "" {
		spConfigPath = "/etc/opsboard-agent/statuspage.json"
	}
	if spCfg, err := loadStatusPageConfig(spConfigPath); err == nil && len(spCfg.Pages) > 0 {
		statusPageServer = statuspage.NewServer(spCfg, storage, certDir)
		if err := statusPageServer.Start(); err != nil {
			slog.Error("failed to start status page server", "error", err)
		} else {
			slog.Info("status page server started", "pages", len(spCfg.Pages))
		}
	} else {
		slog.Info("no status page config found, server not started", "path", spConfigPath)
	}

	// Start heartbeat sender if ServerURL is configured
	var hbSender *heartbeat.Sender
	if cfg.ServerURL != "" {
		hbSender = heartbeat.New(
			cfg.ServerURL,
			cfg.AgentID,
			cfg.APIToken,
			Version,
			60*time.Second,
		)
		hbSender.Start()
	} else {
		log.Printf("No serverUrl configured, heartbeat sender disabled")
	}

	// Start auto-updater (checks GitHub releases periodically)
	agentUpdater := updater.New(Version)
	agentUpdater.Start()

	// Start retention pruning (every 6 hours)
	pruneCtx, pruneCancel := context.WithCancel(context.Background())
	go runRetentionPruning(pruneCtx, storage, defaultRetentionDays, time.Duration(defaultPruneIntervalH)*time.Hour)

	log.Printf("Agent running: agentId=%s, targets=%d, apiPort=%d, syncPort=%d",
		cfg.AgentID, len(cfg.Targets), cfg.APIPort, defaultSyncPort)

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("Received signal %v, shutting down...", sig)

	// Graceful shutdown
	shutdownTimeout := 30 * time.Second
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer shutdownCancel()

	// Stop auto-updater
	agentUpdater.Stop()

	// Stop heartbeat sender
	if hbSender != nil {
		hbSender.Stop()
	}

	// Stop scheduler (waits for running checks to complete)
	sched.Stop()

	// Stop uploaders (will do one final upload each)
	uploaderCancel()
	healthUploaderCancel()

	// Stop sync
	syncClient.Stop()
	syncServer.Shutdown()

	// Stop pruning
	pruneCancel()

	// Stop status page server
	if statusPageServer != nil {
		statusPageServer.Stop()
	}

	// Close storage
	storage.Close()

	// Give uploader a moment to finish
	select {
	case <-shutdownCtx.Done():
		log.Printf("Shutdown timed out")
	case <-time.After(5 * time.Second):
		log.Printf("Shutdown complete")
	}
}

// initKeyPair loads or generates the agent's Ed25519 key pair.
func initKeyPair(keyDir string) (*crypto.KeyPair, error) {
	kp, err := crypto.LoadKeyPair(keyDir)
	if err != nil {
		return nil, fmt.Errorf("load key pair: %w", err)
	}

	if kp != nil {
		slog.Info("loaded existing key pair", "dir", keyDir)
		return kp, nil
	}

	// Generate new key pair on first run
	slog.Info("no key pair found, generating new Ed25519 key pair", "dir", keyDir)
	kp, err = crypto.GenerateKeyPair()
	if err != nil {
		return nil, fmt.Errorf("generate key pair: %w", err)
	}

	if err := crypto.SaveKeyPair(keyDir, kp); err != nil {
		return nil, fmt.Errorf("save key pair: %w", err)
	}

	slog.Info("key pair generated and saved", "dir", keyDir)
	return kp, nil
}

// storeCheckResult stores a health check result in the sync storage with height and signature.
func storeCheckResult(storage *agentsync.Storage, keyPair *crypto.KeyPair, agentID string, resultJSON []byte) {
	height, err := storage.NextHeight()
	if err != nil {
		slog.Error("failed to get next height", "error", err)
		return
	}

	block := crypto.NewCheckResultBlock(height, agentID, resultJSON)
	if err := crypto.SignResult(keyPair.PrivateKey, block); err != nil {
		slog.Error("failed to sign result block", "error", err)
		return
	}

	if err := storage.StoreResult(block); err != nil {
		slog.Error("failed to store result block", "height", height, "error", err)
		return
	}
}

// runRetentionPruning periodically removes old results from storage.
func runRetentionPruning(ctx context.Context, storage *agentsync.Storage, retentionDays int, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("retention pruning started", "retention_days", retentionDays, "interval", interval.String())

	for {
		select {
		case <-ticker.C:
			deleted, err := storage.PruneOlderThan(retentionDays)
			if err != nil {
				slog.Error("retention pruning failed", "error", err)
			} else if deleted > 0 {
				slog.Info("retention pruning complete", "deleted", deleted)
			}
		case <-ctx.Done():
			slog.Info("retention pruning stopped")
			return
		}
	}
}

// loadStatusPageConfig loads the status page configuration from a JSON file.
func loadStatusPageConfig(path string) (*statuspage.Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg statuspage.Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse statuspage config: %w", err)
	}
	return &cfg, nil
}
