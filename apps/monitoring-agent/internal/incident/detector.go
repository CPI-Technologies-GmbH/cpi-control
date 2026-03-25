package incident

import (
	"log"
	"sync"
	"time"

	"opsboard-agent/internal/checker"
	"opsboard-agent/internal/config"
)

// TargetState holds the state machine state for a single monitoring target.
type TargetState struct {
	TargetID             string
	WebsiteID            string
	ConsecutiveFailures  int
	ConsecutiveSuccesses int
	CurrentStatus        string // "up" | "degraded" | "down" | "unknown"
	LastNotificationAt   *time.Time
	IncidentOpen         bool
}

// Event represents a state change or notification event.
type Event struct {
	Type             string    `json:"type"` // "status_change" | "incident_opened" | "incident_resolved" | "notification_required"
	TargetID         string    `json:"targetId"`
	WebsiteID        string    `json:"websiteId"`
	Status           string    `json:"status,omitempty"`
	PreviousStatus   string    `json:"previousStatus,omitempty"`
	NotificationType string    `json:"notificationType,omitempty"`
	Message          string    `json:"message,omitempty"`
	Timestamp        time.Time `json:"timestamp"`
}

// Detector processes check results and detects incidents through a state machine.
type Detector struct {
	mu               sync.Mutex
	states           map[string]*TargetState
	failureThreshold int
	recoveryThreshold int
	cooldownMinutes  int
}

// NewDetector creates a new incident detector with the given thresholds.
func NewDetector(cfg *config.Config) *Detector {
	return &Detector{
		states:            make(map[string]*TargetState),
		failureThreshold:  cfg.CheckDefaults.FailureThreshold,
		recoveryThreshold: cfg.CheckDefaults.RecoveryThreshold,
		cooldownMinutes:   cfg.CheckDefaults.CooldownMinutes,
	}
}

// UpdateConfig updates the detector thresholds from a new config.
func (d *Detector) UpdateConfig(cfg *config.Config) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.failureThreshold = cfg.CheckDefaults.FailureThreshold
	d.recoveryThreshold = cfg.CheckDefaults.RecoveryThreshold
	d.cooldownMinutes = cfg.CheckDefaults.CooldownMinutes
}

// ProcessResult processes a check result and returns any events that should
// be emitted based on the state machine transitions.
func (d *Detector) ProcessResult(result checker.CheckResult) []Event {
	d.mu.Lock()
	defer d.mu.Unlock()

	state := d.getOrCreateState(result.TargetID, result.WebsiteID)
	previousStatus := state.CurrentStatus
	var events []Event
	now := time.Now().UTC()

	switch result.Status {
	case checker.StatusUp:
		state.ConsecutiveSuccesses++
		state.ConsecutiveFailures = 0

		if state.CurrentStatus == "down" || state.CurrentStatus == "degraded" {
			// Check if we have enough consecutive successes for recovery
			if state.ConsecutiveSuccesses >= d.recoveryThreshold {
				state.CurrentStatus = checker.StatusUp

				events = append(events, Event{
					Type:           "status_change",
					TargetID:       result.TargetID,
					WebsiteID:      result.WebsiteID,
					Status:         checker.StatusUp,
					PreviousStatus: previousStatus,
					Timestamp:      now,
				})

				if state.IncidentOpen {
					state.IncidentOpen = false
					events = append(events, Event{
						Type:      "incident_resolved",
						TargetID:  result.TargetID,
						WebsiteID: result.WebsiteID,
						Status:    checker.StatusUp,
						Message:   "Service recovered",
						Timestamp: now,
					})

					// Notification for recovery
					if d.shouldNotify(state, now) {
						state.LastNotificationAt = &now
						events = append(events, Event{
							Type:             "notification_required",
							TargetID:         result.TargetID,
							WebsiteID:        result.WebsiteID,
							Status:           checker.StatusUp,
							NotificationType: "recovery",
							Timestamp:        now,
						})
					}
				}
			}
		} else if state.CurrentStatus == "unknown" {
			state.CurrentStatus = checker.StatusUp
			events = append(events, Event{
				Type:           "status_change",
				TargetID:       result.TargetID,
				WebsiteID:      result.WebsiteID,
				Status:         checker.StatusUp,
				PreviousStatus: previousStatus,
				Timestamp:      now,
			})
		}

	case checker.StatusDegraded:
		state.ConsecutiveFailures = 0
		state.ConsecutiveSuccesses = 0

		if state.CurrentStatus != checker.StatusDegraded {
			state.CurrentStatus = checker.StatusDegraded
			events = append(events, Event{
				Type:           "status_change",
				TargetID:       result.TargetID,
				WebsiteID:      result.WebsiteID,
				Status:         checker.StatusDegraded,
				PreviousStatus: previousStatus,
				Timestamp:      now,
			})
		}

	case checker.StatusDown:
		state.ConsecutiveFailures++
		state.ConsecutiveSuccesses = 0

		if state.CurrentStatus != checker.StatusDown {
			// Only transition to DOWN after threshold consecutive failures
			if state.ConsecutiveFailures >= d.failureThreshold {
				state.CurrentStatus = checker.StatusDown

				events = append(events, Event{
					Type:           "status_change",
					TargetID:       result.TargetID,
					WebsiteID:      result.WebsiteID,
					Status:         checker.StatusDown,
					PreviousStatus: previousStatus,
					Timestamp:      now,
				})

				if !state.IncidentOpen {
					state.IncidentOpen = true
					events = append(events, Event{
						Type:      "incident_opened",
						TargetID:  result.TargetID,
						WebsiteID: result.WebsiteID,
						Status:    checker.StatusDown,
						Message:   result.ErrorMessage,
						Timestamp: now,
					})

					// Notification for downtime
					if d.shouldNotify(state, now) {
						state.LastNotificationAt = &now
						events = append(events, Event{
							Type:             "notification_required",
							TargetID:         result.TargetID,
							WebsiteID:        result.WebsiteID,
							Status:           checker.StatusDown,
							NotificationType: "down",
							Timestamp:        now,
						})
					}
				}
			}
		}
	}

	if len(events) > 0 {
		log.Printf("[incident] target=%s prev=%s new=%s failures=%d successes=%d events=%d",
			result.TargetID, previousStatus, state.CurrentStatus,
			state.ConsecutiveFailures, state.ConsecutiveSuccesses, len(events))
	}

	return events
}

// GetState returns a copy of the current state for a target.
func (d *Detector) GetState(targetID string) *TargetState {
	d.mu.Lock()
	defer d.mu.Unlock()
	state, ok := d.states[targetID]
	if !ok {
		return nil
	}
	cp := *state
	return &cp
}

// Reset clears all state.
func (d *Detector) Reset() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.states = make(map[string]*TargetState)
}

func (d *Detector) getOrCreateState(targetID, websiteID string) *TargetState {
	state, ok := d.states[targetID]
	if !ok {
		state = &TargetState{
			TargetID:      targetID,
			WebsiteID:     websiteID,
			CurrentStatus: "unknown",
		}
		d.states[targetID] = state
	}
	return state
}

func (d *Detector) shouldNotify(state *TargetState, now time.Time) bool {
	if state.LastNotificationAt == nil {
		return true
	}
	cooldown := time.Duration(d.cooldownMinutes) * time.Minute
	return now.Sub(*state.LastNotificationAt) >= cooldown
}
