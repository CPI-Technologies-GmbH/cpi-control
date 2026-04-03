package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"opsboard-agent/internal/crypto"
	agentsync "opsboard-agent/internal/sync"
	"opsboard-agent/internal/statuspage"
)

const (
	defaultKeyDir = "/opt/opsboard-agent"
	defaultDBPath = "/var/lib/opsboard-agent/sync.db"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	keyDir := envOrDefault("AGENT_KEY_DIR", defaultKeyDir)
	dbPath := envOrDefault("AGENT_DB_PATH", defaultDBPath)

	switch os.Args[1] {
	case "keys":
		handleKeys(keyDir)
	case "status":
		handleStatus(keyDir, dbPath)
	case "results":
		handleResults(dbPath)
	case "sync":
		handleSync(keyDir, dbPath)
	case "statuspage":
		handleStatusPage(dbPath)
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println(`cpi-agent-cli - CPI Control Agent Management Tool

Usage:
  cpi-agent-cli <command> [subcommand] [options]

Commands:
  keys generate                            Generate agent keypair
  keys show                                Show agent public key
  keys add-desktop <name> <pubkey>         Add authorized desktop key
  keys remove-desktop <id>                 Remove desktop key
  keys list-desktops                       List authorized desktop keys
  keys add-peer <name> <pubkey> <endpoint> Add peer agent
  keys remove-peer <id>                    Remove peer agent
  keys list-peers                          List peer agents
  status                                   Show agent status (JSON)
  results --since-height N                 Get results since height (JSON)
  sync --now                               Force sync with all peers
  statuspage config <json-file>            Update status page config
  statuspage reload                        Regenerate all pages
  help                                     Show this help

Environment variables:
  AGENT_KEY_DIR   Key directory (default: /opt/opsboard-agent)
  AGENT_DB_PATH   Database path (default: /var/lib/opsboard-agent/sync.db)`)
}

func handleKeys(keyDir string) {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "Usage: cpi-agent-cli keys <subcommand>")
		os.Exit(1)
	}

	ks := crypto.NewKeyStore(keyDir)

	switch os.Args[2] {
	case "generate":
		kp, err := crypto.LoadKeyPair(keyDir)
		if err != nil {
			fatalf("Error checking existing keys: %v\n", err)
		}
		if kp != nil {
			fmt.Println("Key pair already exists. Public key:")
			fmt.Println(crypto.PublicKeyToBase64(kp.PublicKey))
			return
		}
		kp, err = crypto.GenerateKeyPair()
		if err != nil {
			fatalf("Failed to generate key pair: %v\n", err)
		}
		if err := crypto.SaveKeyPair(keyDir, kp); err != nil {
			fatalf("Failed to save key pair: %v\n", err)
		}
		fmt.Println("Key pair generated successfully.")
		fmt.Println("Public key:")
		fmt.Println(crypto.PublicKeyToBase64(kp.PublicKey))

	case "show":
		kp, err := crypto.LoadKeyPair(keyDir)
		if err != nil {
			fatalf("Failed to load key pair: %v\n", err)
		}
		if kp == nil {
			fatalf("No key pair found. Run 'cpi-agent-cli keys generate' first.\n")
		}
		fmt.Println(crypto.PublicKeyToBase64(kp.PublicKey))

	case "add-desktop":
		if len(os.Args) < 5 {
			fatalf("Usage: cpi-agent-cli keys add-desktop <name> <pubkey>\n")
		}
		name := os.Args[3]
		pubkey := os.Args[4]
		if err := ks.AddDesktopKey(name, pubkey); err != nil {
			fatalf("Failed to add desktop key: %v\n", err)
		}
		fmt.Printf("Desktop key '%s' added successfully.\n", name)

	case "remove-desktop":
		if len(os.Args) < 4 {
			fatalf("Usage: cpi-agent-cli keys remove-desktop <id>\n")
		}
		if err := ks.RemoveDesktopKey(os.Args[3]); err != nil {
			fatalf("Failed to remove desktop key: %v\n", err)
		}
		fmt.Println("Desktop key removed.")

	case "list-desktops":
		keys, err := ks.ListDesktopKeys()
		if err != nil {
			fatalf("Failed to list desktop keys: %v\n", err)
		}
		if len(keys) == 0 {
			fmt.Println("No authorized desktop keys.")
			return
		}
		data, _ := json.MarshalIndent(keys, "", "  ")
		fmt.Println(string(data))

	case "add-peer":
		if len(os.Args) < 6 {
			fatalf("Usage: cpi-agent-cli keys add-peer <name> <pubkey> <endpoint>\n")
		}
		name := os.Args[3]
		pubkey := os.Args[4]
		endpoint := os.Args[5]
		if err := ks.AddPeerAgent(name, pubkey, endpoint); err != nil {
			fatalf("Failed to add peer agent: %v\n", err)
		}
		fmt.Printf("Peer agent '%s' added successfully.\n", name)

	case "remove-peer":
		if len(os.Args) < 4 {
			fatalf("Usage: cpi-agent-cli keys remove-peer <id>\n")
		}
		if err := ks.RemovePeerAgent(os.Args[3]); err != nil {
			fatalf("Failed to remove peer agent: %v\n", err)
		}
		fmt.Println("Peer agent removed.")

	case "list-peers":
		peers, err := ks.ListPeerAgents()
		if err != nil {
			fatalf("Failed to list peer agents: %v\n", err)
		}
		if len(peers) == 0 {
			fmt.Println("No peer agents configured.")
			return
		}
		data, _ := json.MarshalIndent(peers, "", "  ")
		fmt.Println(string(data))

	default:
		fmt.Fprintf(os.Stderr, "Unknown keys subcommand: %s\n", os.Args[2])
		os.Exit(1)
	}
}

func handleStatus(keyDir, dbPath string) {
	kp, err := crypto.LoadKeyPair(keyDir)
	if err != nil {
		fatalf("Failed to load key pair: %v\n", err)
	}

	storage, err := agentsync.NewStorage(dbPath)
	if err != nil {
		fatalf("Failed to open database: %v\n", err)
	}
	defer storage.Close()

	height, err := storage.GetLatestHeight()
	if err != nil {
		fatalf("Failed to get latest height: %v\n", err)
	}

	status := map[string]interface{}{
		"has_keypair":    kp != nil,
		"latest_height":  height,
		"db_path":        dbPath,
		"key_dir":        keyDir,
	}
	if kp != nil {
		status["public_key"] = crypto.PublicKeyToBase64(kp.PublicKey)
	}

	data, _ := json.MarshalIndent(status, "", "  ")
	fmt.Println(string(data))
}

func handleResults(dbPath string) {
	sinceHeight := int64(0)

	for i := 2; i < len(os.Args); i++ {
		if os.Args[i] == "--since-height" && i+1 < len(os.Args) {
			var err error
			sinceHeight, err = strconv.ParseInt(os.Args[i+1], 10, 64)
			if err != nil {
				fatalf("Invalid height value: %s\n", os.Args[i+1])
			}
			i++
		}
	}

	storage, err := agentsync.NewStorage(dbPath)
	if err != nil {
		fatalf("Failed to open database: %v\n", err)
	}
	defer storage.Close()

	results, err := storage.GetResultsSince(sinceHeight, 1000)
	if err != nil {
		fatalf("Failed to get results: %v\n", err)
	}

	if results == nil {
		results = []*crypto.CheckResultBlock{}
	}

	data, _ := json.MarshalIndent(results, "", "  ")
	fmt.Println(string(data))
}

func handleSync(keyDir, dbPath string) {
	if len(os.Args) < 3 || os.Args[2] != "--now" {
		fatalf("Usage: cpi-agent-cli sync --now\n")
	}

	ks := crypto.NewKeyStore(keyDir)
	storage, err := agentsync.NewStorage(dbPath)
	if err != nil {
		fatalf("Failed to open database: %v\n", err)
	}
	defer storage.Close()

	client := agentsync.NewSyncClient(storage, ks)
	fmt.Println("Starting sync with all peers...")
	client.SyncAllPeers()
	fmt.Println("Sync complete.")
}

func handleStatusPage(dbPath string) {
	if len(os.Args) < 3 {
		fatalf("Usage: cpi-agent-cli statuspage <config|reload> [args]\n")
	}

	switch os.Args[2] {
	case "config":
		if len(os.Args) < 4 {
			fatalf("Usage: cpi-agent-cli statuspage config <json-file>\n")
		}
		data, err := os.ReadFile(os.Args[3])
		if err != nil {
			fatalf("Failed to read config file: %v\n", err)
		}
		var cfg statuspage.Config
		if err := json.Unmarshal(data, &cfg); err != nil {
			fatalf("Failed to parse config JSON: %v\n", err)
		}
		// Validate
		if len(cfg.Pages) == 0 {
			fatalf("Config must contain at least one page.\n")
		}
		for _, p := range cfg.Pages {
			if p.ID == "" || p.Domain == "" {
				fatalf("Each page must have an id and domain.\n")
			}
		}
		// Save to the standard config location
		configPath := envOrDefault("STATUSPAGE_CONFIG", "/etc/opsboard-agent/statuspage.json")
		formatted, _ := json.MarshalIndent(cfg, "", "  ")
		if err := os.WriteFile(configPath, formatted, 0644); err != nil {
			fatalf("Failed to write config: %v\n", err)
		}
		fmt.Printf("Status page config saved to %s (%d pages)\n", configPath, len(cfg.Pages))

	case "reload":
		storage, err := agentsync.NewStorage(dbPath)
		if err != nil {
			fatalf("Failed to open database: %v\n", err)
		}
		defer storage.Close()

		configPath := envOrDefault("STATUSPAGE_CONFIG", "/etc/opsboard-agent/statuspage.json")
		data, err := os.ReadFile(configPath)
		if err != nil {
			fatalf("Failed to read statuspage config: %v\n", err)
		}
		var cfg statuspage.Config
		if err := json.Unmarshal(data, &cfg); err != nil {
			fatalf("Failed to parse config: %v\n", err)
		}

		for _, page := range cfg.Pages {
			p := page
			html, err := statuspage.GeneratePage(&p, storage)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Failed to generate page %s: %v\n", page.ID, err)
				continue
			}
			fmt.Printf("Generated page '%s' (%s): %d bytes\n", page.ID, page.Domain, len(html))
		}
		fmt.Println("Reload complete.")

	default:
		fatalf("Unknown statuspage subcommand: %s\n", os.Args[2])
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func fatalf(format string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, format, args...)
	os.Exit(1)
}
