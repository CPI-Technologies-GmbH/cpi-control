package crypto

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// PeerAgent represents a remote agent with its public key and network endpoint.
type PeerAgent struct {
	StoredKey
	Endpoint string `json:"endpoint"` // e.g. https://agent-b:9112
}

// KeyStore manages authorized desktop keys and peer agent keys on disk.
// Keys are stored as individual JSON files under subdirectories of the base dir.
type KeyStore struct {
	mu  sync.RWMutex
	dir string // base directory, e.g. /opt/opsboard-agent/
}

// NewKeyStore creates a new KeyStore rooted at the given directory.
func NewKeyStore(dir string) *KeyStore {
	return &KeyStore{dir: dir}
}

// desktopDir returns the path to the authorized_desktops directory.
func (ks *KeyStore) desktopDir() string {
	return filepath.Join(ks.dir, "authorized_desktops")
}

// peerDir returns the path to the peer_agents directory.
func (ks *KeyStore) peerDir() string {
	return filepath.Join(ks.dir, "peer_agents")
}

// generateID creates a short deterministic ID from name and public key.
func generateID(name, pubkey string) string {
	h := sha256.Sum256([]byte(name + ":" + pubkey))
	return hex.EncodeToString(h[:8])
}

// AddDesktopKey saves an authorized desktop public key.
func (ks *KeyStore) AddDesktopKey(name string, pubkey string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	// Validate the public key
	if _, err := Base64ToPublicKey(pubkey); err != nil {
		return fmt.Errorf("invalid public key: %w", err)
	}

	dir := ks.desktopDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create desktop keys dir: %w", err)
	}

	id := generateID(name, pubkey)
	key := StoredKey{
		ID:        id,
		Name:      name,
		PublicKey: pubkey,
		AddedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	data, err := json.MarshalIndent(key, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal desktop key: %w", err)
	}

	path := filepath.Join(dir, id+".json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write desktop key file: %w", err)
	}

	slog.Info("added desktop key", "id", id, "name", name)
	return nil
}

// RemoveDesktopKey removes an authorized desktop key by ID.
func (ks *KeyStore) RemoveDesktopKey(id string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	path := filepath.Join(ks.desktopDir(), id+".json")
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("desktop key %s not found", id)
		}
		return fmt.Errorf("remove desktop key: %w", err)
	}

	slog.Info("removed desktop key", "id", id)
	return nil
}

// ListDesktopKeys returns all authorized desktop keys.
func (ks *KeyStore) ListDesktopKeys() ([]StoredKey, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	return ks.listKeys(ks.desktopDir())
}

// AddPeerAgent saves a peer agent's public key and endpoint.
func (ks *KeyStore) AddPeerAgent(name string, pubkey string, endpoint string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	// Validate the public key
	if _, err := Base64ToPublicKey(pubkey); err != nil {
		return fmt.Errorf("invalid public key: %w", err)
	}

	dir := ks.peerDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create peer agents dir: %w", err)
	}

	id := generateID(name, pubkey)
	peer := PeerAgent{
		StoredKey: StoredKey{
			ID:        id,
			Name:      name,
			PublicKey: pubkey,
			AddedAt:   time.Now().UTC().Format(time.RFC3339),
		},
		Endpoint: endpoint,
	}

	data, err := json.MarshalIndent(peer, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal peer agent: %w", err)
	}

	path := filepath.Join(dir, id+".json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write peer agent file: %w", err)
	}

	slog.Info("added peer agent", "id", id, "name", name, "endpoint", endpoint)
	return nil
}

// RemovePeerAgent removes a peer agent by ID.
func (ks *KeyStore) RemovePeerAgent(id string) error {
	ks.mu.Lock()
	defer ks.mu.Unlock()

	path := filepath.Join(ks.peerDir(), id+".json")
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("peer agent %s not found", id)
		}
		return fmt.Errorf("remove peer agent: %w", err)
	}

	slog.Info("removed peer agent", "id", id)
	return nil
}

// ListPeerAgents returns all configured peer agents.
func (ks *KeyStore) ListPeerAgents() ([]PeerAgent, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	dir := ks.peerDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read peer agents dir: %w", err)
	}

	var peers []PeerAgent
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			slog.Warn("failed to read peer agent file", "file", entry.Name(), "error", err)
			continue
		}
		var peer PeerAgent
		if err := json.Unmarshal(data, &peer); err != nil {
			slog.Warn("failed to parse peer agent file", "file", entry.Name(), "error", err)
			continue
		}
		peers = append(peers, peer)
	}

	return peers, nil
}

// GetDesktopKey retrieves a desktop key by ID.
func (ks *KeyStore) GetDesktopKey(id string) (*StoredKey, error) {
	ks.mu.RLock()
	defer ks.mu.RUnlock()

	path := filepath.Join(ks.desktopDir(), id+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read desktop key: %w", err)
	}

	var key StoredKey
	if err := json.Unmarshal(data, &key); err != nil {
		return nil, fmt.Errorf("parse desktop key: %w", err)
	}
	return &key, nil
}

// IsAuthorizedDesktop checks if a given base64 public key is in the authorized desktop keys.
func (ks *KeyStore) IsAuthorizedDesktop(pubkeyB64 string) bool {
	keys, err := ks.ListDesktopKeys()
	if err != nil {
		return false
	}
	for _, k := range keys {
		if k.PublicKey == pubkeyB64 {
			return true
		}
	}
	return false
}

// listKeys reads all StoredKey JSON files from a directory.
func (ks *KeyStore) listKeys(dir string) ([]StoredKey, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read keys dir %s: %w", dir, err)
	}

	var keys []StoredKey
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			slog.Warn("failed to read key file", "file", entry.Name(), "error", err)
			continue
		}
		var key StoredKey
		if err := json.Unmarshal(data, &key); err != nil {
			slog.Warn("failed to parse key file", "file", entry.Name(), "error", err)
			continue
		}
		keys = append(keys, key)
	}

	return keys, nil
}
