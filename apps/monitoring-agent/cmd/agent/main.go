package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"opsboard-agent/internal/api"
	"opsboard-agent/internal/config"
	"opsboard-agent/internal/events"
	"opsboard-agent/internal/heartbeat"
	"opsboard-agent/internal/incident"
	"opsboard-agent/internal/notify"
	"opsboard-agent/internal/scheduler"
	"opsboard-agent/internal/updater"
)

// Version is set by ldflags at build time.
var Version = "dev"

const (
	defaultConfigPath      = "/etc/opsboard-agent/config.json"
	defaultEventsDir       = "/var/lib/opsboard-agent/events"
	defaultHealthResultDir = "/var/lib/opsboard-agent/health-results"
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

	// Load configuration
	cfgMgr := config.NewManager(configPath)
	if err := cfgMgr.Load(); err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}
	cfg := cfgMgr.Get()

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

	log.Printf("Agent running: agentId=%s, targets=%d, apiPort=%d",
		cfg.AgentID, len(cfg.Targets), cfg.APIPort)

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

	// Give uploader a moment to finish
	select {
	case <-shutdownCtx.Done():
		log.Printf("Shutdown timed out")
	case <-time.After(5 * time.Second):
		log.Printf("Shutdown complete")
	}
}
