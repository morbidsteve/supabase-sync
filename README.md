# supabase-sync

CLI tool to sync data between Supabase cloud and local Postgres databases. Pull your cloud database to a local Docker-managed Postgres for development or archiving, and push it back when you're ready. No host PostgreSQL installation required — everything runs in Docker.

<p align="center">
  <img src="demo.gif" alt="supabase-sync demo" width="720">
</p>

## Features

- **Pull** cloud data to a local database
- **Push** local data back to the cloud
- **Docker-first** — `pg_dump` and `psql` run inside containers; a local Postgres container is auto-provisioned and managed
- **Storage sync** — pull/push Supabase Storage files (with optional local S3/MinIO support)
- **Interactive TUI** — guided setup and operation, or use CLI flags for scripting
- **IPv6 workaround** — automatically detects Supabase regions and rewrites direct database URLs to the IPv4 connection pooler, so Docker networking works on macOS

## Requirements

- **Node.js** >= 18
- **Docker** (recommended) or native `psql` + `pg_dump` on PATH

## Installation

```bash
# From npm
npm install -g supabase-sync

# Or clone and link
git clone https://github.com/morbidsteve/supabase-sync.git
cd supabase-sync
pnpm install && pnpm build
pnpm link --global
```

## Quick Start

```bash
# 1. Initialize — connects to your Supabase project, creates a local Docker DB
supabase-sync init

# 2. Pull cloud data to local
supabase-sync pull

# 3. Check what you have locally
supabase-sync status

# 4. Push local data to a (new or existing) cloud project
supabase-sync push

# Dry run — see what would be synced without changing anything
supabase-sync preview

# Configure credentials, sync options, Docker settings
supabase-sync settings
```

Run without arguments for the interactive menu:

```bash
supabase-sync
```

## Docker Integration

supabase-sync can operate entirely via Docker — no host PostgreSQL installation needed:

- **pg tools via Docker** — `pg_dump` and `psql` run inside `postgres:17-alpine` containers
- **Managed local database** — during `init`, choose "Create a Docker-managed database" to auto-provision a local Postgres container with persistent storage
- **Auto-start** — `pull` and `push` commands automatically start the managed container if it's stopped

Manage the Docker database:

```bash
supabase-sync settings  # → "Manage Docker database"
```

## How It Works

1. **Pull** (`cloud → local`):
   - `pg_dump` the cloud database (via connection pooler) to a SQL file
   - `psql` restore into the local Docker Postgres
   - Download Supabase Storage files (if configured)

2. **Push** (`local → cloud`):
   - `pg_dump` the local Docker Postgres
   - `psql` restore to the cloud database
   - Upload storage files to Supabase (if configured)

The dump uses `--clean --if-exists --no-owner --no-privileges` by default — configurable in settings.

## Configuration

Configuration is stored in `.supabase-sync.json` in your project directory. It tracks:

- **Cloud credentials** — Supabase project URL, database URL (pooler), API keys, region
- **Local database** — connection URL (or Docker-managed container config)
- **Sync options** — schemas to include, tables to exclude, dump flags
- **Storage settings** — Supabase Storage and optional local S3/MinIO

Sensitive files are automatically added to `.gitignore` during init.

## CLI Reference

| Command | Description |
|---------|-------------|
| `supabase-sync init` | Interactive setup — connect to Supabase, create local DB |
| `supabase-sync pull [-y]` | Pull cloud data to local (`-y` skips confirmation) |
| `supabase-sync push [-y]` | Push local data to cloud (`-y` skips confirmation) |
| `supabase-sync preview` | Dry run — show what would be synced |
| `supabase-sync status` | Check connections, show table counts |
| `supabase-sync settings` | Configure credentials, Docker, sync options |

## Project Structure

```
src/
├── index.ts              # CLI entry point + interactive menu
├── commands/             # Command implementations
│   ├── init.ts           # Project initialization
│   ├── pull.ts           # Cloud → local sync
│   ├── push.ts           # Local → cloud sync
│   ├── preview.ts        # Dry run preview
│   ├── status.ts         # Connection & data status
│   └── settings.ts       # Configuration management
├── core/                 # Core modules
│   ├── config.ts         # Config types and file I/O
│   ├── credentials.ts    # Credential auto-detection from .env files
│   ├── env.ts            # .env file parser
│   └── supabase-url.ts   # URL rewriting and region detection
├── db/                   # Database operations
│   ├── connection.ts     # Connection testing
│   ├── discovery.ts      # Table discovery and row counts
│   ├── dump.ts           # pg_dump wrapper
│   └── restore.ts        # psql restore wrapper
├── docker/               # Docker integration
│   ├── docker-check.ts   # Docker availability and platform detection
│   ├── pg-tools.ts       # Abstraction layer — native or Docker execution
│   └── local-db.ts       # Container lifecycle management
├── storage/              # Storage sync
│   ├── supabase.ts       # Supabase Storage operations
│   ├── s3.ts             # S3-compatible local storage
│   └── sync.ts           # Storage sync orchestration
└── ui/                   # Terminal UI
    ├── format.ts         # Chalk formatting utilities
    └── prompts.ts        # Confirmation prompts
```

## License

MIT
