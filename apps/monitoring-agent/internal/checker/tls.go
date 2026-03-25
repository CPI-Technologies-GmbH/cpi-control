package checker

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net"
	"net/url"
	"time"
)

// TLSResult holds the outcome of a TLS certificate check.
type TLSResult struct {
	Valid     bool       `json:"valid"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	Issuer    string     `json:"issuer,omitempty"`
	Subject   string     `json:"subject,omitempty"`
	Warning   string     `json:"warning,omitempty"`
	Error     string     `json:"error,omitempty"`
}

const (
	// TLSExpiryWarningDays is the number of days before expiry at which
	// a warning is generated.
	TLSExpiryWarningDays = 14
)

// CheckTLS inspects a TLS connection state and validates certificates.
func CheckTLS(state *tls.ConnectionState) TLSResult {
	result := TLSResult{Valid: true}

	if state == nil || len(state.PeerCertificates) == 0 {
		result.Valid = false
		result.Error = "no peer certificates"
		return result
	}

	leaf := state.PeerCertificates[0]
	result.Subject = leaf.Subject.CommonName
	result.Issuer = leaf.Issuer.CommonName
	expiresAt := leaf.NotAfter
	result.ExpiresAt = &expiresAt

	now := time.Now()

	// Check if expired
	if now.After(leaf.NotAfter) {
		result.Valid = false
		result.Error = fmt.Sprintf("certificate expired on %s", leaf.NotAfter.Format(time.RFC3339))
		return result
	}

	// Check if not yet valid
	if now.Before(leaf.NotBefore) {
		result.Valid = false
		result.Error = fmt.Sprintf("certificate not valid until %s", leaf.NotBefore.Format(time.RFC3339))
		return result
	}

	// Check expiry warning
	daysUntilExpiry := time.Until(leaf.NotAfter).Hours() / 24
	if daysUntilExpiry < TLSExpiryWarningDays {
		result.Warning = fmt.Sprintf("certificate expires in %.0f days on %s",
			daysUntilExpiry, leaf.NotAfter.Format(time.RFC3339))
	}

	// Verify certificate chain
	if len(state.PeerCertificates) > 1 {
		intermediates := x509.NewCertPool()
		for _, cert := range state.PeerCertificates[1:] {
			intermediates.AddCert(cert)
		}
		opts := x509.VerifyOptions{
			Intermediates: intermediates,
		}
		if _, err := leaf.Verify(opts); err != nil {
			result.Valid = false
			result.Error = fmt.Sprintf("certificate chain verification failed: %v", err)
			return result
		}
	}

	return result
}

// CheckTLSEndpoint performs a TLS handshake with the given endpoint and
// returns the TLS check result.
func CheckTLSEndpoint(endpoint string, timeoutMs int) TLSResult {
	parsedURL, err := url.Parse(endpoint)
	if err != nil {
		return TLSResult{Valid: false, Error: fmt.Sprintf("invalid URL: %v", err)}
	}

	host := parsedURL.Hostname()
	port := parsedURL.Port()
	if port == "" {
		if parsedURL.Scheme == "https" {
			port = "443"
		} else {
			return TLSResult{Valid: false, Error: "not an HTTPS endpoint"}
		}
	}

	addr := net.JoinHostPort(host, port)
	timeout := time.Duration(timeoutMs) * time.Millisecond
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	dialer := &net.Dialer{Timeout: timeout}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{
		ServerName: host,
	})
	if err != nil {
		return TLSResult{Valid: false, Error: fmt.Sprintf("TLS handshake failed: %v", err)}
	}
	defer conn.Close()

	state := conn.ConnectionState()
	result := CheckTLS(&state)
	log.Printf("[tls] %s: valid=%v, expires=%v, warning=%s",
		host, result.Valid, result.ExpiresAt, result.Warning)
	return result
}
