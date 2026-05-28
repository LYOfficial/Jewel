# Jewel

**Next-gen Lightweight Git to Docker Deployment Tool**

[简体中文](README.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md)

---

## Overview

Jewel is a lightweight Git-to-Docker deployment platform inspired by Dokploy and Portainer. It helps you quickly build and deploy projects from Git repositories using Docker Compose.

### Features

- **Git Integration** — GitHub / GitLab Token support, one-click repo selection
- **Docker Compose Deployment** — Auto clone, build, and deploy containers
- **Container Management** — Portainer-like panel for status, logs, and resource monitoring
- **Environment Variables** — Visual editor for project environment variables
- **Auto Deploy** — Webhook support for automatic deployment on Git Push
- **Self-Update** — Detects new versions and prompts for update confirmation
- **i18n** — Simplified Chinese / Traditional Chinese / English / Japanese

### Design Philosophy

- Black/white/grey minimalist color scheme
- Zero frontend build dependencies — vanilla HTML/CSS/JS
- Single-process architecture with embedded SQLite
- Minimal resource usage

---

## Quick Start

### Docker (Recommended)

One-command install, no docker-compose required:

```bash
curl -sSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh | sh
```

Custom port:

```bash
# Download the script first
curl -sSL https://raw.githubusercontent.com/LYOfficial/Jewel/main/install.sh -o install.sh
chmod +x install.sh
# Install with custom port
./install.sh 8080
```

Visit `http://localhost:330` to get started.

### Local

Requires Node.js 20+ and Docker.

```bash
git clone https://github.com/LYOfficial/Jewel.git
cd Jewel
npm install
npm start
```

---

## Default Credentials

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `adminwithjewel` |

**Password must be changed on first login.**

---

## Port

Default: `330`. Can be changed via the `PORT` environment variable.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `330` | Service port |
| `DATA_DIR` | `./data` | Data storage directory |
| `JWT_SECRET` | `jewel-secret-change-in-production` | JWT secret (change in production!) |
| `NODE_ENV` | `development` | Runtime environment |

---

## Self-Update

Jewel periodically checks the GitHub repository for new commits. When a new version is detected, an update banner appears in the bottom-left corner. After user confirmation, Jewel automatically pulls the latest code, builds a new image, and restarts the container.

The update uses a two-phase mechanism: first the new image is built, then a restart button appears. Clicking it replaces the current container with the new one. This works regardless of whether Jewel was deployed via `install.sh` or `docker compose`.

> Unlike other tools, Jewel does not auto-update — it requires manual confirmation.

---

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JavaScript (no build step)
- **Database**: SQLite (better-sqlite3)
- **Docker**: dockerode + docker-cli
- **Git**: simple-git

---

## License

MIT License

---

<p align="center">Made with ♥ by <a href="https://github.com/LYOfficial">LYOfficial</a></p>
