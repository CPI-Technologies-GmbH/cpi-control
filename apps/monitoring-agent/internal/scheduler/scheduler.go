package scheduler

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/robfig/cron/v3"

	"opsboard-agent/internal/checker"
	"opsboard-agent/internal/config"
	"opsboard-agent/internal/events"
	"opsboard-agent/internal/incident"
	"opsboard-agent/internal/notify"
)

// Scheduler manages cron-based health check scheduling.
type Scheduler struct {
	mu            sync.Mutex
	cron          *cron.Cron
	cfgMgr        *config.Manager
	detector      *incident.Detector
	buffer        *events.Buffer
	healthBuffer  *events.HealthResultBuffer
	notifier      *notify.SlackNotifier
	httpClient    *http.Client
	checksTotal   atomic.Int64
	checksFailed  atomic.Int64
	workerPool    chan struct{}
	ctx           context.Context
	cancel        context.CancelFunc
}

// NewScheduler creates a new check scheduler.
func NewScheduler(
	cfgMgr *config.Manager,
	detector *incident.Detector,
	buffer *events.Buffer,
	healthBuffer *events.HealthResultBuffer,
	notifier *notify.SlackNotifier,
) *Scheduler {
	ctx, cancel := context.WithCancel(context.Background())
	return &Scheduler{
		cfgMgr:       cfgMgr,
		detector:     detector,
		buffer:       buffer,
		healthBuffer: healthBuffer,
		notifier:     notifier,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
		workerPool: make(chan struct{}, 20), // Max 20 concurrent checks
		ctx:        ctx,
		cancel:     cancel,
	}
}

// Start begins scheduling checks for all configured targets.
func (s *Scheduler) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg := s.cfgMgr.Get()
	return s.startCron(cfg)
}

// Reconfigure stops current checks and re-schedules with the new config.
func (s *Scheduler) Reconfigure(cfg *config.Config) {
	s.mu.Lock()
	defer s.mu.Unlock()

	log.Printf("[scheduler] Reconfiguring with %d targets", len(cfg.Targets))

	if s.cron != nil {
		s.cron.Stop()
	}

	if err := s.startCron(cfg); err != nil {
		log.Printf("[scheduler] ERROR: failed to reconfigure: %v", err)
	}
}

// Stop gracefully stops the scheduler.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.cancel()
	if s.cron != nil {
		ctx := s.cron.Stop()
		<-ctx.Done()
		log.Printf("[scheduler] Stopped, total=%d failed=%d",
			s.checksTotal.Load(), s.checksFailed.Load())
	}
}

// ChecksTotal returns the total number of checks performed.
func (s *Scheduler) ChecksTotal() int64 {
	return s.checksTotal.Load()
}

// ChecksFailed returns the total number of failed checks.
func (s *Scheduler) ChecksFailed() int64 {
	return s.checksFailed.Load()
}

func (s *Scheduler) startCron(cfg *config.Config) error {
	s.cron = cron.New(cron.WithSeconds())

	for _, target := range cfg.Targets {
		t := target // capture loop variable
		spec := fmt.Sprintf("@every %ds", t.CheckIntervalSeconds)

		_, err := s.cron.AddFunc(spec, func() {
			s.runCheck(t)
		})
		if err != nil {
			return fmt.Errorf("failed to schedule check for target %s: %w", t.ID, err)
		}
		log.Printf("[scheduler] Scheduled target %s (%s) every %ds",
			t.ID, t.Endpoint, t.CheckIntervalSeconds)
	}

	s.cron.Start()
	log.Printf("[scheduler] Started with %d targets", len(cfg.Targets))
	return nil
}

func (s *Scheduler) runCheck(target config.Target) {
	// Acquire worker slot
	select {
	case s.workerPool <- struct{}{}:
	case <-s.ctx.Done():
		return
	}
	defer func() { <-s.workerPool }()

	s.checksTotal.Add(1)

	// Execute the check
	result := checker.CheckHTTP(s.ctx, target)

	if result.Status == checker.StatusDown {
		s.checksFailed.Add(1)
	}

	// Send per-check health result to backend
	s.reportHealthResult(result)

	// Process through incident detector
	incidentEvents := s.detector.ProcessResult(result)

	// Buffer events for upload
	if len(incidentEvents) > 0 {
		if err := s.buffer.WriteMultiple(incidentEvents); err != nil {
			log.Printf("[scheduler] ERROR: failed to buffer events: %v", err)
		}

		// Send Slack notifications for notification_required events
		for _, evt := range incidentEvents {
			if evt.Type == "notification_required" {
				s.sendSlackNotification(evt, target)
			}
		}
	}
}

// reportHealthResult sends a health check result to the backend. If the backend
// is unreachable, the result is buffered locally for later retry.
func (s *Scheduler) reportHealthResult(result checker.CheckResult) {
	cfg := s.cfgMgr.Get()
	if cfg.ServerURL == "" {
		// No server configured; buffer locally
		if s.healthBuffer != nil {
			if err := s.healthBuffer.Write(result); err != nil {
				log.Printf("[scheduler] ERROR: failed to buffer health result: %v", err)
			}
		}
		return
	}

	// Try direct send first
	err := events.SendResultDirect(s.httpClient, cfg.ServerURL, cfg.APIToken, cfg.AgentID, result)
	if err != nil {
		// Backend unreachable, buffer locally for retry
		log.Printf("[scheduler] Failed to send health result for %s: %v (buffering for retry)", result.TargetID, err)
		if s.healthBuffer != nil {
			if bufErr := s.healthBuffer.Write(result); bufErr != nil {
				log.Printf("[scheduler] ERROR: failed to buffer health result: %v", bufErr)
			}
		}
	}
}

func (s *Scheduler) sendSlackNotification(evt incident.Event, target config.Target) {
	if s.notifier == nil {
		return
	}

	var msg notify.SlackMessage
	switch evt.NotificationType {
	case "down":
		msg = notify.BuildDownMessage(
			target.WebsiteName,
			target.Endpoint,
			evt.Message,
			evt.Timestamp,
		)
	case "recovery":
		msg = notify.BuildRecoveryMessage(
			target.WebsiteName,
			target.Endpoint,
			evt.Timestamp, // approximate; real downSince would need state tracking
			evt.Timestamp,
		)
	default:
		return
	}

	if err := s.notifier.SendMessage(msg); err != nil {
		log.Printf("[scheduler] ERROR: failed to send Slack notification: %v", err)
	}
}
