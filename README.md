# OpsBoard

Hybrides Local-First Ops Tool zur zentralen Überwachung und Diagnose von Websites und Deployments.

## Architektur

| Komponente | Technologie | Zweck |
|---|---|---|
| **Desktop Frontend** | React + TypeScript + TailwindCSS | Dashboard, Verwaltung, Deployment Board |
| **Backend (Sidecar)** | Fastify + Drizzle ORM + SQLite | REST API, Datenmodell, Integrationen |
| **Remote Agent** | Go | Uptime-Checks, TLS-Prüfung, Alerting |

## Voraussetzungen

- **Node.js** >= 20.x LTS
- **pnpm** >= 9.x (`npm install -g pnpm`)
- **Go** >= 1.22 (nur für den Remote Monitoring Agent)

## Installation & Start

```bash
# 1. Dependencies installieren
cd opsboard
pnpm install

# 2. Backend starten (Port 19876)
pnpm dev:backend

# 3. Frontend starten (Port 5173) – in einem zweiten Terminal
pnpm dev:desktop
```

Die App ist dann unter **http://localhost:5173** erreichbar.

## Verfügbare Scripts

| Script | Beschreibung |
|---|---|
| `pnpm dev` | Backend + Frontend parallel starten |
| `pnpm dev:backend` | Nur Backend starten (Port 19876) |
| `pnpm dev:desktop` | Nur Frontend starten (Port 5173) |
| `pnpm build:backend` | Backend bauen |
| `pnpm build:desktop` | Frontend bauen (in `apps/desktop/dist/`) |
| `pnpm test` | Alle Tests ausführen |

## Projektstruktur

```
opsboard/
├── apps/
│   ├── desktop/                    # React Frontend (Vite)
│   │   ├── src/
│   │   │   ├── components/         # UI-Komponenten
│   │   │   ├── hooks/              # TanStack Query Hooks
│   │   │   ├── stores/             # Zustand State Management
│   │   │   ├── lib/                # API Client, Formatter
│   │   │   └── types/              # TypeScript Types
│   │   └── ...
│   └── monitoring-agent/           # Go Remote Agent
│       ├── cmd/agent/              # Entrypoint
│       ├── internal/               # Checker, Scheduler, Detector
│       └── ...
├── packages/
│   └── backend/                    # Fastify Backend
│       ├── src/
│       │   ├── db/                 # Drizzle Schema + Client
│       │   ├── modules/            # API-Module
│       │   │   ├── inventory/      # Kunden, Websites, Targets
│       │   │   ├── integrations/   # Provider-Sync
│       │   │   ├── deployments/    # Deployment Aggregation
│       │   │   ├── incidents/      # Incident Detection
│       │   │   ├── notifications/  # Slack Alerts
│       │   │   ├── ai-diagnostics/ # KI-Diagnose (OpenAI)
│       │   │   ├── secrets/        # OS Keychain Integration
│       │   │   └── agent-lifecycle/# Remote Agent Management
│       │   ├── providers/          # GitHub, Vercel, K8s, DO, Slack
│       │   └── shared/             # Logger, Rate Limiter, Retry
│       └── ...
├── scripts/                        # Install/Uninstall/Dev-Setup
└── .github/workflows/              # CI/CD
```

## API-Übersicht

Das Backend läuft auf `http://127.0.0.1:19876` und bietet folgende Endpoints:

### Inventory
- `GET/POST` `/api/inventory/customers` – Kunden verwalten
- `GET/POST` `/api/inventory/websites` – Websites verwalten
- `POST` `/api/inventory/websites/:id/monitoring-targets` – Monitoring Targets
- `POST` `/api/inventory/websites/:id/infra-bindings` – Infrastruktur-Bindings
- `POST` `/api/inventory/websites/:id/repo-bindings` – Repository-Bindings

### Dashboard
- `GET /api/dashboard/summary` – Aggregierte Kennzahlen
- `GET /api/dashboard/health-overview` – Alle Websites mit Status

### Integrations
- `GET/PUT` `/api/integrations/configs` – Provider-Konfigurationen
- `POST /api/integrations/sync/:provider` – Manueller Sync

### Deployments
- `GET /api/deployments` – Deployment-Liste mit Korrelationen

### Incidents
- `GET /api/incidents` – Incidents mit Timeline
- `POST /api/incidents/:id/acknowledge` – Bestätigen
- `POST /api/incidents/:id/resolve` – Auflösen

### KI-Diagnose
- `POST /api/ai/diagnose/:websiteId` – Diagnose starten
- `GET /api/ai/runs` – Vergangene Diagnosen

### Secrets
- `GET /api/secrets/providers` – Provider-Status
- `POST/DELETE /api/secrets/:provider` – Secrets verwalten

### Agent Lifecycle
- `POST /api/agents/install` – Remote Agent installieren
- `POST /api/agents/sync` – Konfiguration synchronisieren
- `POST /api/agents/uninstall` – Agent deinstallieren

## Remote Monitoring Agent (Go)

```bash
cd apps/monitoring-agent

# Lokal bauen
make build

# Für Linux (Deployment auf Droplet)
make build-linux

# Tests
make test
```

## Integrationen

| Provider | Typ | MVP |
|---|---|---|
| GitHub | Repos, Commits, Actions | ✅ |
| Vercel | Projekte, Deployments | ✅ |
| Kubernetes | Pods, Deployments, Events | ✅ |
| DigitalOcean | Droplets, Metriken | ✅ |
| Slack | Benachrichtigungen | ✅ |
| OpenAI | KI-Diagnose | ✅ |
| Bitbucket | Repos, Pipelines | Phase 2 |
| Semaphore | Projekte, Pipelines | Phase 2 |

## Datenbank

SQLite mit Drizzle ORM. Die DB wird automatisch bei Start unter `./data.db` erstellt.

Pfad konfigurierbar über Umgebungsvariable:
```bash
OPSBOARD_DB_PATH=~/.opsboard/data.db pnpm dev:backend
```

## Tests

```bash
# Backend-Tests
cd packages/backend && pnpm test

# Frontend-Tests
cd apps/desktop && pnpm test

# Go Agent Tests
cd apps/monitoring-agent && make test

# Alle Tests
pnpm test
```

## Umgebungsvariablen

| Variable | Default | Beschreibung |
|---|---|---|
| `OPSBOARD_DB_PATH` | `./data.db` | Pfad zur SQLite-Datenbank |
| `OPSBOARD_PORT` | `19876` | Backend-Port |
| `OPSBOARD_HOST` | `127.0.0.1` | Backend-Host |
| `VITE_API_BASE_URL` | `http://localhost:19876` | Frontend API Base URL |

## Lizenz

Proprietär – CPI Technologies
