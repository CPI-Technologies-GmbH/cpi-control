package config

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
)

// ConfigResponse is the response returned after a config push.
type ConfigResponse struct {
	Status     string `json:"status"`
	ConfigHash string `json:"configHash"`
	Targets    int    `json:"targets"`
	Message    string `json:"message,omitempty"`
}

// ErrorResponse is a standard error response.
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// HandleConfigPush returns an HTTP handler for receiving config pushes.
// It validates the bearer token and applies the new configuration.
func HandleConfigPush(mgr *Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, ErrorResponse{
				Error:   "method_not_allowed",
				Message: "Only POST is allowed",
			})
			return
		}

		// Validate bearer token
		cfg := mgr.Get()
		if cfg.APIToken != "" {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				writeJSON(w, http.StatusUnauthorized, ErrorResponse{
					Error:   "unauthorized",
					Message: "Missing Authorization header",
				})
				return
			}
			token := strings.TrimPrefix(authHeader, "Bearer ")
			if token == authHeader || token != cfg.APIToken {
				writeJSON(w, http.StatusForbidden, ErrorResponse{
					Error:   "forbidden",
					Message: "Invalid API token",
				})
				return
			}
		}

		// Read body
		body, err := io.ReadAll(io.LimitReader(r.Body, 10*1024*1024)) // 10MB limit
		if err != nil {
			writeJSON(w, http.StatusBadRequest, ErrorResponse{
				Error:   "bad_request",
				Message: "Failed to read request body",
			})
			return
		}
		defer r.Body.Close()

		if len(body) == 0 {
			writeJSON(w, http.StatusBadRequest, ErrorResponse{
				Error:   "bad_request",
				Message: "Empty request body",
			})
			return
		}

		// Apply new config
		newCfg, err := mgr.Apply(body)
		if err != nil {
			log.Printf("[config-api] Failed to apply config: %v", err)
			writeJSON(w, http.StatusBadRequest, ErrorResponse{
				Error:   "invalid_config",
				Message: err.Error(),
			})
			return
		}

		log.Printf("[config-api] Config pushed successfully, hash=%s, targets=%d", newCfg.ConfigHash, len(newCfg.Targets))

		writeJSON(w, http.StatusOK, ConfigResponse{
			Status:     "ok",
			ConfigHash: newCfg.ConfigHash,
			Targets:    len(newCfg.Targets),
			Message:    "Config applied successfully",
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
