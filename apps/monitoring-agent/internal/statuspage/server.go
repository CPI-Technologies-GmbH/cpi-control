package statuspage

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	agentsync "opsboard-agent/internal/sync"

	"golang.org/x/crypto/acme/autocert"
)

// Server serves public status pages with automatic HTTPS via LetsEncrypt.
type Server struct {
	mu       sync.RWMutex
	config   *Config
	storage  *agentsync.Storage
	certDir  string
	server   *http.Server
	cache    map[string]cachedPage // domain -> cached HTML
}

type cachedPage struct {
	html      []byte
	generated time.Time
}

const cacheTTL = 30 * time.Second

// NewServer creates a new status page server.
func NewServer(config *Config, storage *agentsync.Storage, certDir string) *Server {
	return &Server{
		config:  config,
		storage: storage,
		certDir: certDir,
		cache:   make(map[string]cachedPage),
	}
}

// Start starts the HTTPS server on :443 (and HTTP on :80 for ACME challenges).
// If no pages are configured, it returns immediately.
func (s *Server) Start() error {
	s.mu.RLock()
	if s.config == nil || len(s.config.Pages) == 0 {
		s.mu.RUnlock()
		slog.Info("no status pages configured, server not started")
		return nil
	}
	s.mu.RUnlock()

	domains := s.getDomains()
	if len(domains) == 0 {
		return fmt.Errorf("no domains configured for status pages")
	}

	if err := os.MkdirAll(s.certDir, 0755); err != nil {
		return fmt.Errorf("create cert directory %s: %w", s.certDir, err)
	}

	certManager := autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domains...),
		Cache:      autocert.DirCache(s.certDir),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleRequest)
	mux.HandleFunc("/api/status", s.handleAPIStatus)

	s.server = &http.Server{
		Addr:      ":443",
		Handler:   mux,
		TLSConfig: &tls.Config{GetCertificate: certManager.GetCertificate},
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start HTTP server for ACME challenges on :80
	go func() {
		httpServer := &http.Server{
			Addr:    ":80",
			Handler: certManager.HTTPHandler(nil),
		}
		slog.Info("status page HTTP server starting on :80 (ACME challenges)")
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP ACME server error", "error", err)
		}
	}()

	slog.Info("status page HTTPS server starting on :443", "domains", domains)
	go func() {
		if err := s.server.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTPS server error", "error", err)
		}
	}()

	return nil
}

// Stop gracefully shuts down the status page server.
func (s *Server) Stop() error {
	if s.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	slog.Info("shutting down status page server")
	return s.server.Shutdown(ctx)
}

// UpdateConfig hot-reloads the status page configuration and invalidates caches.
func (s *Server) UpdateConfig(config *Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.config = config
	s.cache = make(map[string]cachedPage) // invalidate all cached pages
	slog.Info("status page config updated", "pages", len(config.Pages))
}

func (s *Server) getDomains() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var domains []string
	for _, page := range s.config.Pages {
		if page.Domain != "" {
			domains = append(domains, page.Domain)
		}
	}
	return domains
}

func (s *Server) findPage(domain string) *PageConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := range s.config.Pages {
		if s.config.Pages[i].Domain == domain {
			return &s.config.Pages[i]
		}
	}
	return nil
}

func (s *Server) handleRequest(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "" {
		http.NotFound(w, r)
		return
	}

	host := r.Host
	page := s.findPage(host)
	if page == nil {
		// Try without port
		if idx := len(host) - 1; idx > 0 {
			for i := idx; i >= 0; i-- {
				if host[i] == ':' {
					page = s.findPage(host[:i])
					break
				}
			}
		}
	}

	if page == nil {
		// If only one page configured, serve it regardless of domain
		s.mu.RLock()
		if len(s.config.Pages) == 1 {
			page = &s.config.Pages[0]
		}
		s.mu.RUnlock()
	}

	if page == nil {
		http.NotFound(w, r)
		return
	}

	html, err := s.getCachedOrGenerate(page)
	if err != nil {
		slog.Error("failed to generate status page", "page", page.ID, "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=30")
	w.Write(html)
}

func (s *Server) handleAPIStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	host := r.Host
	page := s.findPage(host)
	if page == nil {
		s.mu.RLock()
		if len(s.config.Pages) == 1 {
			page = &s.config.Pages[0]
		}
		s.mu.RUnlock()
	}

	if page == nil {
		http.NotFound(w, r)
		return
	}

	pageData, err := buildPageData(page, s.storage)
	if err != nil {
		slog.Error("failed to build page data", "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=30")
	json.NewEncoder(w).Encode(pageData)
}

func (s *Server) getCachedOrGenerate(page *PageConfig) ([]byte, error) {
	s.mu.RLock()
	cached, ok := s.cache[page.Domain]
	s.mu.RUnlock()

	if ok && time.Since(cached.generated) < cacheTTL {
		return cached.html, nil
	}

	html, err := GeneratePage(page, s.storage)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.cache[page.Domain] = cachedPage{html: html, generated: time.Now()}
	s.mu.Unlock()

	return html, nil
}
