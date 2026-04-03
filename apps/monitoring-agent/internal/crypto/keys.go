package crypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

// KeyPair holds an Ed25519 public/private key pair used for signing and verification.
type KeyPair struct {
	PublicKey  ed25519.PublicKey
	PrivateKey ed25519.PrivateKey
}

// StoredKey represents a serialized public key with metadata.
type StoredKey struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	PublicKey string `json:"public_key"` // base64-encoded
	AddedAt   string `json:"added_at"`
}

// GenerateKeyPair generates a new Ed25519 key pair.
func GenerateKeyPair() (*KeyPair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate ed25519 keypair: %w", err)
	}
	return &KeyPair{
		PublicKey:  pub,
		PrivateKey: priv,
	}, nil
}

// LoadKeyPair loads an Ed25519 key pair from agent.key and agent.pub in the given directory.
// Returns nil, nil if the files do not exist.
func LoadKeyPair(dir string) (*KeyPair, error) {
	privPath := filepath.Join(dir, "agent.key")
	pubPath := filepath.Join(dir, "agent.pub")

	privData, err := os.ReadFile(privPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read private key %s: %w", privPath, err)
	}

	pubData, err := os.ReadFile(pubPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("public key missing but private key exists at %s", privPath)
		}
		return nil, fmt.Errorf("read public key %s: %w", pubPath, err)
	}

	privKey, err := base64.StdEncoding.DecodeString(string(privData))
	if err != nil {
		return nil, fmt.Errorf("decode private key: %w", err)
	}
	pubKey, err := base64.StdEncoding.DecodeString(string(pubData))
	if err != nil {
		return nil, fmt.Errorf("decode public key: %w", err)
	}

	if len(privKey) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("invalid private key size: got %d, want %d", len(privKey), ed25519.PrivateKeySize)
	}
	if len(pubKey) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid public key size: got %d, want %d", len(pubKey), ed25519.PublicKeySize)
	}

	return &KeyPair{
		PublicKey:  ed25519.PublicKey(pubKey),
		PrivateKey: ed25519.PrivateKey(privKey),
	}, nil
}

// SaveKeyPair saves an Ed25519 key pair to agent.key (0600) and agent.pub (0644) in the given directory.
func SaveKeyPair(dir string, kp *KeyPair) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create key directory %s: %w", dir, err)
	}

	privPath := filepath.Join(dir, "agent.key")
	pubPath := filepath.Join(dir, "agent.pub")

	privB64 := base64.StdEncoding.EncodeToString(kp.PrivateKey)
	pubB64 := base64.StdEncoding.EncodeToString(kp.PublicKey)

	if err := os.WriteFile(privPath, []byte(privB64), 0600); err != nil {
		return fmt.Errorf("write private key %s: %w", privPath, err)
	}
	if err := os.WriteFile(pubPath, []byte(pubB64), 0644); err != nil {
		return fmt.Errorf("write public key %s: %w", pubPath, err)
	}

	return nil
}

// PublicKeyToBase64 encodes an Ed25519 public key to base64.
func PublicKeyToBase64(pub ed25519.PublicKey) string {
	return base64.StdEncoding.EncodeToString(pub)
}

// Base64ToPublicKey decodes a base64-encoded Ed25519 public key.
func Base64ToPublicKey(s string) (ed25519.PublicKey, error) {
	data, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("decode base64 public key: %w", err)
	}
	if len(data) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("invalid public key size: got %d, want %d", len(data), ed25519.PublicKeySize)
	}
	return ed25519.PublicKey(data), nil
}
