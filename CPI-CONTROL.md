# CPI-Control — Infrastructure & Service Management Platform

## Overview

CPI-Control ist eine Desktop-Anwendung (macOS/Windows) zur zentralen Verwaltung, Monitoring und Steuerung von Cloud-Infrastruktur und Services. Die Software aggregiert Daten aus verschiedenen Cloud-Providern, CI/CD-Systemen und Kubernetes-Clustern in einer einheitlichen Oberfläche.

---

## Features

### Service Discovery & Management
- **Automatische Service-Erkennung** aus Kubernetes, Vercel, GitHub und weiteren Providern
- **Multi-Cluster Kubernetes** — Verwaltung mehrerer K8s-Cluster mit separaten Kubeconfigs
- **Service-Kategorisierung** — Public (Website) vs. Private (Backend) Services
- **Projekt-Zuordnung** — Services werden Projekten zugeordnet mit Batch-Operations
- **Mute-Funktion** — Services für 1h/12h/1d/7d/permanent stummschalten (keine Notifications)
- **Archivierung** — Services aus Listen ausblenden, keine Health-Checks, keine Notifications

### Health Monitoring
- **HTTP Health Checks** mit konfigurierbarem Intervall und erwartetem Status-Code
- **Status-Tracking** — Healthy, Degraded, Down, Unknown
- **Response Time Monitoring** mit historischen Daten
- **Incident-Erkennung** — Automatische Incident-Erstellung nach konsekutiven Failures
- **Auto-Recovery** — Automatische Incident-Auflösung nach Recovery
- **Incident-Metadaten** — Response Headers + Body (max 15KB) beim ersten DOWN gespeichert

### Kubernetes Integration
- **Pod-Status & Metrics** — CPU/Memory pro Pod, Replica-Status
- **Multi-Cluster Support** — Separate Kubeconfigs pro Cluster (Vacabee DEV, Vaiipay, CPI Cluster)
- **Namespace-Management** — Automatische Namespace-Discovery aus Infrastructure-Bindings
- **Deployment-Restart** — K8s Deployments direkt aus der UI neustarten
- **Terminal-Zugang** — Pod-Auswahl-Modal, öffnet macOS Terminal mit `kubectl exec`
- **CronJob-Verwaltung** — K8s CronJobs anzeigen und verwalten

### Deployment Tracking
- **Multi-Provider** — Vercel, GitHub Actions, Semaphore, Kubernetes Deployments
- **Projekt-spezifische Deployments** — Eigener Deployments-Tab pro Projekt
- **Sortierung nach Ausführungsdatum** (startedAt statt createdAt)
- **Correlation Engine** — Erkennt Zusammenhänge zwischen Deployments und Incidents

### Log-Management
- **Multi-Cluster Log-Aggregation** via `stern` (Kubernetes)
- **In-Memory Ring Buffer** mit konfigurierbarer Größe (1K-100K Einträge)
- **Live Tail** via SSE (Server-Sent Events)
- **Log-Deduplication** — Konsekutive gleiche Service/Level-Zeilen werden zusammengefasst
- **ANSI-Code Stripping** — Saubere Log-Nachrichten ohne Escape-Sequences
- **Persistierte Column-Settings** — Spalten-Konfiguration in localStorage
- **Standalone Log-Fenster** — Separates Fenster für Live-Logs (Tauri WebviewWindow)
- **Collapsible Sidebar** — Service-Filter ein-/ausblendbar

### Push Notifications
- **SSE-basierte Push-Benachrichtigungen** für Service-Status-Änderungen
- **Mute-Awareness** — Gemutete/archivierte Services lösen keine Notifications aus
- **Batching** — Verhindert Notification-Floods bei Cluster-Ausfällen
- **Konfigurierbare Regeln** — Slack, Email, Webhook als Channels

### Integrations
- **GitHub** — Repository-Discovery, GitHub Actions Deployments
- **Vercel** — Projekt-Synchronisation, Deployment-Tracking, Logs
- **Kubernetes** — Service-Discovery, Deployments, Pods, Metrics, Events, CronJobs, Logs
- **DigitalOcean** — Infrastructure-Management
- **AWS** — Access Key/Secret Key Konfiguration
- **Google Cloud** — Service Account JSON Konfiguration
- **Microsoft Azure** — Tenant/Client/Subscription Konfiguration
- **Semaphore CI** — Deployment-Tracking
- **Slack** — Notification-Channel

### Desktop App
- **Tauri v2** — Native macOS (.dmg) und Windows (.msi/.exe) Builds
- **Backend Sidecar** — Node.js Backend wird als Prozess im Hintergrund gestartet
- **Watchdog** — Automatischer Neustart bei Backend-Crash
- **Auto-Update** — Tauri Updater mit GitHub Releases
- **Persistente Daten** — SQLite-DB in `~/Library/Application Support/` (überlebt App-Updates)
- **Keychain-Integration** — Secrets werden im macOS Keychain gespeichert

### Projekte
- **Projekt-Dashboard** mit Status-Übersicht, Timeline, Recent Deployments
- **Projekt-Icons** — Emoji oder kurzer Text als visueller Identifier
- **Service-Assignment** — Batch-Zuordnung mit Select All/Deselect All

### AI Diagnostics
- **KI-gestützte Fehleranalyse** bei Service-Problemen
- **Automatische Diagnose-Schritte** mit Tool-Aufrufen
- **Empfehlungen** und Root-Cause-Analyse

### Settings & Updates
- **Updates-Tab** — App- und Agent-Update-Checks via GitHub Releases API
- **Agent-Management** — Remote Monitoring Agents installieren, konfigurieren, updaten
- **Backend-Management** — Backend-Status, Logs, Restart
- **General** — Log Buffer Size, Data Reset mit Re-Sync

---

## USPs (Unique Selling Points)

1. **All-in-One Desktop App** — Keine Cloud-Abhängigkeit, läuft lokal mit Zugriff auf alle K8s-Cluster
2. **Multi-Cluster First** — Native Unterstützung für mehrere K8s-Cluster und Cloud-Provider
3. **Developer-Focused** — Terminal-Zugang zu Pods, Live-Logs, Deployment-Tracking
4. **Privacy by Default** — Alle Daten bleiben lokal (SQLite + Keychain), kein Cloud-Account nötig
5. **Zero-Config Discovery** — Automatische Service-Erkennung aus bestehender Infrastruktur
6. **Real-Time Monitoring** — SSE-basierte Live-Updates, Push-Notifications, Live-Logs

---

## SWOT-Analyse

### Strengths
- Umfassende Multi-Provider-Integration (K8s, Vercel, GitHub, AWS, GCloud, Azure)
- Desktop-App mit nativer Performance und Keychain-Integration
- Automatische Service-Discovery ohne manuelle Konfiguration
- Multi-Cluster K8s-Support mit separaten Kubeconfigs
- Privacy-First: Alle Daten lokal

### Weaknesses
- Desktop-only (kein Web-Dashboard für Team-Zugriff)
- Abhängigkeit von `stern` für K8s-Logs (muss separat installiert sein)
- AI Diagnostics benötigt externen API-Key (OpenAI)
- Keine Multi-User/RBAC-Unterstützung

### Opportunities
- Web-Version für Team-Kollaboration
- Mobile Companion App (Alerts, Status-Checks)
- Plugin-System für Custom-Provider
- Marketplace für vorgefertigte Health-Check-Templates
- Integration mit PagerDuty, OpsGenie, etc.

### Threats
- Bestehende Tools: Datadog, Grafana, Lens, Portainer
- Cloud-Provider-eigene Monitoring-Tools (CloudWatch, Stackdriver)
- Kubernetes-native Tools (ArgoCD, Rancher)

---

## Use Cases

### 1. DevOps Engineer — Daily Operations
- Überblick über alle Services und deren Status
- Quick-Access zu K8s-Pods und Logs bei Problemen
- Deployment-Status über alle CI/CD-Systeme hinweg

### 2. Tech Lead — Project Management
- Projekt-Dashboard mit allen zugehörigen Services
- Incident-Tracking und Resolution-Zeiten
- Deployment-Frequenz und Erfolgsraten

### 3. On-Call Engineer — Incident Response
- Push-Notifications bei Service-Ausfällen
- AI-Diagnose für schnelle Root-Cause-Analyse
- Terminal-Zugang zu betroffenen Pods
- Response Headers/Body bei HTTP-Fehlern

### 4. Platform Engineer — Infrastructure Management
- Multi-Cluster Kubernetes-Verwaltung
- CronJob-Monitoring
- Infrastructure-Binding-Übersicht (welcher Service läuft wo)

### 5. Freelancer / Agency — Client Management
- Projekte = Kunden, Services = deren Infrastruktur
- Mute für wartungsfreie Phasen
- Archivierung abgeschlossener Projekte

---

## Target Groups

| Zielgruppe | Hauptnutzen |
|-----------|-------------|
| **DevOps Engineers** | Zentrale Infrastruktur-Übersicht, schneller Zugriff auf Logs & Pods |
| **Tech Leads** | Projekt-übergreifendes Monitoring, Deployment-Tracking |
| **Small Engineering Teams** | Ersetzt teure SaaS-Tools (Datadog, etc.) durch lokale Lösung |
| **Freelancer & Agencies** | Multi-Client-Verwaltung mit Projekt-Isolation |
| **Startups** | Schnelles Setup ohne Cloud-Vendor-Lock-in |
| **On-Call Engineers** | Incident-Response mit AI-Diagnostics und Terminal-Zugang |

---

## Tech Stack

| Komponente | Technologie |
|-----------|------------|
| Desktop Runtime | Tauri v2 (Rust) |
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| State Management | TanStack Query (React Query) |
| Backend | Node.js + Fastify |
| ORM | Drizzle ORM |
| Database | SQLite (better-sqlite3) |
| Secret Store | macOS Keychain / Encrypted Fallback |
| Monitoring Agent | Go (remote server monitoring) |
| CI/CD | GitHub Actions |
| Package Manager | pnpm v9 + Turborepo |
