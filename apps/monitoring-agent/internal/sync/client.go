package sync

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"opsboard-agent/internal/crypto"
)

// SyncClient handles pulling results from peer agents and verifying their signatures.
type SyncClient struct {
	storage    *Storage
	keyStore   *crypto.KeyStore
	httpClient *http.Client
	stopCh     chan struct{}
	wg         sync.WaitGroup
}

// NewSyncClient creates a new sync client.
func NewSyncClient(storage *Storage, ks *crypto.KeyStore) *SyncClient {
	return &SyncClient{
		storage:  storage,
		keyStore: ks,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		stopCh: make(chan struct{}),
	}
}

// SyncFromPeer fetches new results from a single peer, verifies their signatures,
// and stores them locally.
func (sc *SyncClient) SyncFromPeer(peer *crypto.PeerAgent) error {
	// Resolve the peer's public key
	pubKey, err := crypto.Base64ToPublicKey(peer.PublicKey)
	if err != nil {
		return fmt.Errorf("invalid peer public key for %s: %w", peer.Name, err)
	}

	// Get last synced height for this peer
	lastHeight, err := sc.storage.GetPeerSyncState(peer.ID)
	if err != nil {
		return fmt.Errorf("get peer sync state for %s: %w", peer.Name, err)
	}

	// Fetch peer status to check if there are new results
	statusURL := fmt.Sprintf("%s/api/v1/sync/status", peer.Endpoint)
	statusResp, err := sc.httpClient.Get(statusURL)
	if err != nil {
		return fmt.Errorf("fetch status from %s: %w", peer.Endpoint, err)
	}
	defer statusResp.Body.Close()

	if statusResp.StatusCode != http.StatusOK {
		return fmt.Errorf("peer %s returned status %d", peer.Endpoint, statusResp.StatusCode)
	}

	var status StatusResponse
	if err := json.NewDecoder(statusResp.Body).Decode(&status); err != nil {
		return fmt.Errorf("decode status from %s: %w", peer.Endpoint, err)
	}

	// No new results
	if status.LatestHeight <= lastHeight {
		slog.Debug("no new results from peer", "peer", peer.Name, "latest", status.LatestHeight, "last_synced", lastHeight)
		return nil
	}

	// Fetch results since our last known height
	resultsURL := fmt.Sprintf("%s/api/v1/sync/results?since_height=%d&limit=1000", peer.Endpoint, lastHeight)
	resultsResp, err := sc.httpClient.Get(resultsURL)
	if err != nil {
		return fmt.Errorf("fetch results from %s: %w", peer.Endpoint, err)
	}
	defer resultsResp.Body.Close()

	if resultsResp.StatusCode != http.StatusOK {
		return fmt.Errorf("peer %s results returned status %d", peer.Endpoint, resultsResp.StatusCode)
	}

	var resultsBody ResultsResponse
	if err := json.NewDecoder(resultsResp.Body).Decode(&resultsBody); err != nil {
		return fmt.Errorf("decode results from %s: %w", peer.Endpoint, err)
	}

	// Verify and store each result
	var storedCount int
	var maxHeight int64

	for _, block := range resultsBody.Results {
		// Verify the signature using the peer's known public key
		if !crypto.VerifyResult(pubKey, block) {
			slog.Warn("signature verification failed for block from peer",
				"peer", peer.Name, "height", block.Height)
			continue
		}

		// Store the verified block
		if err := sc.storage.StoreResult(block); err != nil {
			slog.Error("failed to store synced block",
				"peer", peer.Name, "height", block.Height, "error", err)
			continue
		}

		storedCount++
		if block.Height > maxHeight {
			maxHeight = block.Height
		}
	}

	// Update sync state
	if maxHeight > lastHeight {
		if err := sc.storage.SetPeerSyncState(peer.ID, maxHeight); err != nil {
			return fmt.Errorf("update sync state for %s: %w", peer.Name, err)
		}
	}

	if storedCount > 0 {
		slog.Info("synced results from peer",
			"peer", peer.Name, "stored", storedCount, "max_height", maxHeight)
	}

	return nil
}

// SyncAllPeers synchronizes results from all configured peer agents.
func (sc *SyncClient) SyncAllPeers() {
	peers, err := sc.keyStore.ListPeerAgents()
	if err != nil {
		slog.Error("failed to list peer agents", "error", err)
		return
	}

	for i := range peers {
		peer := &peers[i]
		if err := sc.SyncFromPeer(peer); err != nil {
			slog.Warn("failed to sync from peer", "peer", peer.Name, "error", err)
		}
	}
}

// StartPeriodicSync starts a background goroutine that syncs with all peers at the given interval.
func (sc *SyncClient) StartPeriodicSync(interval time.Duration) {
	sc.wg.Add(1)
	go func() {
		defer sc.wg.Done()

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		slog.Info("periodic peer sync started", "interval", interval.String())

		// Do an initial sync immediately
		sc.SyncAllPeers()

		for {
			select {
			case <-ticker.C:
				sc.SyncAllPeers()
			case <-sc.stopCh:
				slog.Info("periodic peer sync stopped")
				return
			}
		}
	}()
}

// Stop signals the periodic sync goroutine to stop and waits for it to finish.
func (sc *SyncClient) Stop() {
	close(sc.stopCh)
	sc.wg.Wait()
}
