package crypto

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"
)

// CheckResultBlock is a height-indexed, signed block of check results.
type CheckResultBlock struct {
	Height    int64           `json:"height"`
	AgentID   string          `json:"agent_id"`
	Timestamp string          `json:"timestamp"`
	Checks    json.RawMessage `json:"checks"`
	Hash      string          `json:"hash"`      // SHA256 hex of checks
	Signature string          `json:"signature"`  // Ed25519 base64 signature
}

// NewCheckResultBlock creates a new block at the given height with the provided check results.
func NewCheckResultBlock(height int64, agentID string, checks json.RawMessage) *CheckResultBlock {
	return &CheckResultBlock{
		Height:    height,
		AgentID:   agentID,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Checks:    checks,
	}
}

// HashData computes the SHA256 hex digest of the given data.
func HashData(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// Sign produces an Ed25519 signature over the given data.
func Sign(privateKey ed25519.PrivateKey, data []byte) []byte {
	return ed25519.Sign(privateKey, data)
}

// Verify checks an Ed25519 signature over the given data.
func Verify(publicKey ed25519.PublicKey, data, signature []byte) bool {
	return ed25519.Verify(publicKey, data, signature)
}

// SignResult computes the hash of the checks payload, then signs the
// concatenation of height + agent_id + timestamp + hash, storing both
// the hash and signature in the block.
func SignResult(privateKey ed25519.PrivateKey, result *CheckResultBlock) error {
	if result == nil {
		return fmt.Errorf("result block is nil")
	}

	result.Hash = HashData(result.Checks)

	payload := signingPayload(result)
	sig := Sign(privateKey, payload)
	result.Signature = base64.StdEncoding.EncodeToString(sig)

	return nil
}

// VerifyResult verifies the hash and signature of a check result block.
func VerifyResult(publicKey ed25519.PublicKey, result *CheckResultBlock) bool {
	if result == nil {
		return false
	}

	// Verify hash
	expectedHash := HashData(result.Checks)
	if result.Hash != expectedHash {
		return false
	}

	// Verify signature
	sigBytes, err := base64.StdEncoding.DecodeString(result.Signature)
	if err != nil {
		return false
	}

	payload := signingPayload(result)
	return Verify(publicKey, payload, sigBytes)
}

// signingPayload constructs the deterministic byte sequence that is signed.
func signingPayload(result *CheckResultBlock) []byte {
	return []byte(fmt.Sprintf("%d:%s:%s:%s", result.Height, result.AgentID, result.Timestamp, result.Hash))
}
