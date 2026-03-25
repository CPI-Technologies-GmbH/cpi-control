package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"opsboard-agent/internal/config"
	"opsboard-agent/internal/events"
	"opsboard-agent/internal/scheduler"
)

// Server is the HTTP API server for the monitoring agent.
type Server struct {
	cfgMgr    *config.Manager
	scheduler *scheduler.Scheduler
	buffer    *events.Buffer
	startedAt time.Time
	mux       *http.ServeMux
	version   string
}

// HealthResponse is returned by the GET /health endpoint.
type HealthResponse struct {
	Status       string `json:"status"`
	Version      string `json:"version"`
	Uptime       int64  `json:"uptime"`
	TargetsCount int    `json:"targetsCount"`
}

// HeartbeatResponse is returned by the GET /heartbeat endpoint.
type HeartbeatResponse struct {
	AgentID      string `json:"agentId"`
	Status       string `json:"status"`
	ConfigHash   string `json:"configHash"`
	LastCheckAt  string `json:"lastCheckAt"`
	ChecksTotal  int64  `json:"checksTotal"`
	ChecksFailed int64  `json:"checksFailed"`
}

// PendingEventsResponse is returned by the GET /events/pending endpoint.
type PendingEventsResponse struct {
	Events []events.BufferedEvent `json:"events"`
	Count  int                    `json:"count"`
}

// AckRequest is the request body for POST /events/ack.
type AckRequest struct {
	EventIDs []string `json:"eventIds"`
}

// AckResponse is the response for POST /events/ack.
type AckResponse struct {
	Acknowledged int      `json:"acknowledged"`
	Failed       []string `json:"failed,omitempty"`
}

// ErrorResponse is a standard error response.
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// NewServer creates a new API server.
func NewServer(
	cfgMgr *config.Manager,
	sched *scheduler.Scheduler,
	buffer *events.Buffer,
	version string,
) *Server {
	s := &Server{
		cfgMgr:    cfgMgr,
		scheduler: sched,
		buffer:    buffer,
		startedAt: time.Now(),
		mux:       http.NewServeMux(),
		version:   version,
	}
	s.registerRoutes()
	return s
}

// Handler returns the HTTP handler for the API server.
func (s *Server) Handler() http.Handler {
	return s.mux
}

// ListenAndServe starts the HTTP server on the given address.
func (s *Server) ListenAndServe(addr string) error {
	server := &http.Server{
		Addr:         addr,
		Handler:      s.mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	log.Printf("[api] Starting HTTP server on %s", addr)
	return server.ListenAndServe()
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("/health", s.handleHealth)
	s.mux.HandleFunc("/heartbeat", s.withAuth(s.handleHeartbeat))
	s.mux.HandleFunc("/config", s.withAuth(config.HandleConfigPush(s.cfgMgr)))
	s.mux.HandleFunc("/events/pending", s.withAuth(s.handleEventsPending))
	s.mux.HandleFunc("/events/ack", s.withAuth(s.handleEventsAck))
}

// withAuth is middleware that validates the bearer token.
func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cfg := s.cfgMgr.Get()
		if cfg.APIToken == "" {
			// No auth configured, allow all
			next(w, r)
			return
		}

		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			writeJSONResponse(w, http.StatusUnauthorized, ErrorResponse{
				Error:   "unauthorized",
				Message: "Missing Authorization header",
			})
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader || token != cfg.APIToken {
			writeJSONResponse(w, http.StatusForbidden, ErrorResponse{
				Error:   "forbidden",
				Message: "Invalid API token",
			})
			return
		}

		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONResponse(w, http.StatusMethodNotAllowed, ErrorResponse{
			Error: "method_not_allowed", Message: "Only GET is allowed",
		})
		return
	}

	cfg := s.cfgMgr.Get()
	uptime := int64(time.Since(s.startedAt).Seconds())

	writeJSONResponse(w, http.StatusOK, HealthResponse{
		Status:       "ok",
		Version:      s.version,
		Uptime:       uptime,
		TargetsCount: len(cfg.Targets),
	})
}

func (s *Server) handleHeartbeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONResponse(w, http.StatusMethodNotAllowed, ErrorResponse{
			Error: "method_not_allowed", Message: "Only GET is allowed",
		})
		return
	}

	cfg := s.cfgMgr.Get()

	writeJSONResponse(w, http.StatusOK, HeartbeatResponse{
		AgentID:      cfg.AgentID,
		Status:       "running",
		ConfigHash:   cfg.ConfigHash,
		LastCheckAt:  time.Now().UTC().Format(time.RFC3339),
		ChecksTotal:  s.scheduler.ChecksTotal(),
		ChecksFailed: s.scheduler.ChecksFailed(),
	})
}

func (s *Server) handleEventsPending(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSONResponse(w, http.StatusMethodNotAllowed, ErrorResponse{
			Error: "method_not_allowed", Message: "Only GET is allowed",
		})
		return
	}

	pending, err := s.buffer.ReadPending()
	if err != nil {
		writeJSONResponse(w, http.StatusInternalServerError, ErrorResponse{
			Error:   "internal_error",
			Message: fmt.Sprintf("Failed to read pending events: %v", err),
		})
		return
	}

	if pending == nil {
		pending = []events.BufferedEvent{}
	}

	writeJSONResponse(w, http.StatusOK, PendingEventsResponse{
		Events: pending,
		Count:  len(pending),
	})
}

func (s *Server) handleEventsAck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONResponse(w, http.StatusMethodNotAllowed, ErrorResponse{
			Error: "method_not_allowed", Message: "Only POST is allowed",
		})
		return
	}

	var req AckRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONResponse(w, http.StatusBadRequest, ErrorResponse{
			Error:   "bad_request",
			Message: "Invalid JSON body",
		})
		return
	}

	acknowledged := 0
	var failed []string

	for _, id := range req.EventIDs {
		if err := s.buffer.MarkSent(id); err != nil {
			failed = append(failed, id)
			log.Printf("[api] Failed to acknowledge event %s: %v", id, err)
		} else {
			acknowledged++
		}
	}

	writeJSONResponse(w, http.StatusOK, AckResponse{
		Acknowledged: acknowledged,
		Failed:       failed,
	})
}

func writeJSONResponse(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
