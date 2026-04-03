package sync

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"opsboard-agent/internal/crypto"
)

// SyncServer exposes the agent's signed results over HTTP for peer-to-peer synchronization.
type SyncServer struct {
	storage  *Storage
	keyPair  *crypto.KeyPair
	keyStore *crypto.KeyStore
	agentID  string
	mux      *http.ServeMux
	server   *http.Server
}

// StatusResponse is the response for GET /api/v1/sync/status.
type StatusResponse struct {
	AgentID      string `json:"agent_id"`
	PublicKey    string `json:"public_key"`
	LatestHeight int64  `json:"latest_height"`
	Timestamp    string `json:"timestamp"`
}

// ResultsResponse is the response for GET /api/v1/sync/results.
type ResultsResponse struct {
	Results []*crypto.CheckResultBlock `json:"results"`
	Count   int                        `json:"count"`
}

// AnnounceRequest is the request body for POST /api/v1/sync/announce.
type AnnounceRequest struct {
	AgentID   string `json:"agent_id"`
	PublicKey string `json:"public_key"`
	Endpoint  string `json:"endpoint"`
	Name      string `json:"name"`
}

// SyncErrorResponse is a standard error response for sync endpoints.
type SyncErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// NewSyncServer creates a new sync server with the provided dependencies.
func NewSyncServer(storage *Storage, kp *crypto.KeyPair, ks *crypto.KeyStore, agentID string) *SyncServer {
	ss := &SyncServer{
		storage:  storage,
		keyPair:  kp,
		keyStore: ks,
		agentID:  agentID,
		mux:      http.NewServeMux(),
	}
	ss.registerRoutes()
	return ss
}

func (ss *SyncServer) registerRoutes() {
	ss.mux.HandleFunc("/api/v1/sync/status", ss.handleStatus)
	ss.mux.HandleFunc("/api/v1/sync/results", ss.handleResults)
	ss.mux.HandleFunc("/api/v1/sync/announce", ss.handleAnnounce)
}

// ListenAndServe starts the sync HTTP server on the given address.
func (ss *SyncServer) ListenAndServe(addr string) error {
	ss.server = &http.Server{
		Addr:         addr,
		Handler:      ss.mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	slog.Info("sync server starting", "addr", addr)
	return ss.server.ListenAndServe()
}

// Shutdown gracefully shuts down the sync server.
func (ss *SyncServer) Shutdown() error {
	if ss.server != nil {
		return ss.server.Close()
	}
	return nil
}

// Handler returns the HTTP handler (useful for testing).
func (ss *SyncServer) Handler() http.Handler {
	return ss.mux
}

func (ss *SyncServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, SyncErrorResponse{
			Error: "method_not_allowed", Message: "Only GET is allowed",
		})
		return
	}

	height, err := ss.storage.GetLatestHeight()
	if err != nil {
		slog.Error("failed to get latest height", "error", err)
		writeJSON(w, http.StatusInternalServerError, SyncErrorResponse{
			Error: "internal_error", Message: "Failed to get latest height",
		})
		return
	}

	writeJSON(w, http.StatusOK, StatusResponse{
		AgentID:      ss.agentID,
		PublicKey:    crypto.PublicKeyToBase64(ss.keyPair.PublicKey),
		LatestHeight: height,
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
	})
}

func (ss *SyncServer) handleResults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, SyncErrorResponse{
			Error: "method_not_allowed", Message: "Only GET is allowed",
		})
		return
	}

	sinceStr := r.URL.Query().Get("since_height")
	sinceHeight := int64(0)
	if sinceStr != "" {
		var err error
		sinceHeight, err = strconv.ParseInt(sinceStr, 10, 64)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, SyncErrorResponse{
				Error: "bad_request", Message: fmt.Sprintf("Invalid since_height: %s", sinceStr),
			})
			return
		}
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 1000 // default
	if limitStr != "" {
		var err error
		limit, err = strconv.Atoi(limitStr)
		if err != nil || limit <= 0 || limit > 10000 {
			writeJSON(w, http.StatusBadRequest, SyncErrorResponse{
				Error: "bad_request", Message: "Invalid limit (must be 1-10000)",
			})
			return
		}
	}

	results, err := ss.storage.GetResultsSince(sinceHeight, limit)
	if err != nil {
		slog.Error("failed to get results", "error", err, "since_height", sinceHeight)
		writeJSON(w, http.StatusInternalServerError, SyncErrorResponse{
			Error: "internal_error", Message: "Failed to get results",
		})
		return
	}

	if results == nil {
		results = []*crypto.CheckResultBlock{}
	}

	writeJSON(w, http.StatusOK, ResultsResponse{
		Results: results,
		Count:   len(results),
	})
}

func (ss *SyncServer) handleAnnounce(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, SyncErrorResponse{
			Error: "method_not_allowed", Message: "Only POST is allowed",
		})
		return
	}

	var req AnnounceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, SyncErrorResponse{
			Error: "bad_request", Message: "Invalid JSON body",
		})
		return
	}

	if req.AgentID == "" || req.PublicKey == "" || req.Endpoint == "" {
		writeJSON(w, http.StatusBadRequest, SyncErrorResponse{
			Error: "bad_request", Message: "agent_id, public_key, and endpoint are required",
		})
		return
	}

	// Validate the public key format
	if _, err := crypto.Base64ToPublicKey(req.PublicKey); err != nil {
		writeJSON(w, http.StatusBadRequest, SyncErrorResponse{
			Error: "bad_request", Message: fmt.Sprintf("Invalid public key: %v", err),
		})
		return
	}

	name := req.Name
	if name == "" {
		name = req.AgentID
	}

	if err := ss.keyStore.AddPeerAgent(name, req.PublicKey, req.Endpoint); err != nil {
		slog.Error("failed to add peer agent", "error", err, "agent_id", req.AgentID)
		writeJSON(w, http.StatusInternalServerError, SyncErrorResponse{
			Error: "internal_error", Message: "Failed to add peer agent",
		})
		return
	}

	slog.Info("peer announced", "agent_id", req.AgentID, "endpoint", req.Endpoint)
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "accepted",
		"message": "Peer registered",
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
