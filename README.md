# supabase-sync

CLI tool to sync data between Supabase cloud and local Postgres databases. Only requires Docker on the host machine -- no PostgreSQL client tools needed.

## Features

- **Pull** cloud data to a local database
- **Push** local data to the cloud
- **Docker-first**: runs `pg_dump`/`psql` inside containers, auto-manages a local Postgres container
- **Multi-project**: manage multiple Supabase projects from one tool via a global registry
- **Storage sync**: pull/push Supabase Storage files (with optional local S3 support)
- **Interactive TUI**: guided setup and operation, or use CLI flags for scripting

## Requirements

- **Node.js** >= 18
- **Docker** (recommended) -- or native `psql`/`pg_dump` on PATH

## Installation

```bash
# Clone and install
git clone https://github.com/morbidsteve/supabase-sync.git
cd supabase-sync
pnpm install
pnpm build

# Link globally
pnpm link --global
```

## Quick Start

```bash
# Initialize a new project (interactive setup)
supabase-sync init

# Pull cloud data to local
supabase-sync pull

# Push local data to cloud
supabase-sync push

# Check connection status
supabase-sync status

# Dry run preview
supabase-sync preview

# Configure credentials and options
supabase-sync settings
```

Run without arguments for the interactive menu:

```bash
supabase-sync
```

## Multi-Project Support

Projects are stored in a global registry at `~/.supabase-sync/projects.json`.

```bash
# Initialize multiple projects
supabase-sync init   # first project
supabase-sync init   # second project

# Operate on a specific project
supabase-sync --project my-project pull
supabase-sync --project my-project status

# Switch default project in the interactive menu
supabase-sync  # select "Switch Project"
```

## Docker Integration

supabase-sync can operate entirely via Docker with no host PostgreSQL installation:

- **pg tools via Docker**: `pg_dump` and `psql` run inside `postgres:16-alpine` containers
- **Managed local database**: during `init`, choose "Create a Docker-managed database" to auto-provision a local Postgres container with persistent storage
- **Auto-start**: `pull` and `push` commands automatically start the Docker database if it's stopped

Manage the Docker database from settings:

```bash
supabase-sync settings  # select "Manage Docker database"
```

## How It Works

1. **Pull** (`cloud -> local`):
   - `pg_dump` the cloud database to a SQL file
   - `psql` restore to local database
   - Download Supabase Storage files (if configured)

2. **Push** (`local -> cloud`):
   - `pg_dump` the local database
   - `psql` restore to cloud database
   - Upload storage files to Supabase (if configured)

## Configuration

Per-project configuration is stored in the global registry. Each project tracks:

- Cloud credentials (Supabase project URL, database URL, API keys)
- Local database credentials (or Docker-managed container)
- Sync options (schemas, excluded tables, dump flags)
- Storage settings (S3-compatible local storage)

## Project Structure

```
src/
  index.ts              # CLI entry point + interactive menu
  commands/             # Command implementations
    init.ts             # Project initialization
    pull.ts             # Cloud -> local sync
    push.ts             # Local -> cloud sync
    preview.ts          # Dry run preview
    status.ts           # Connection & data status
    settings.ts         # Configuration management
  core/                 # Core modules
    config.ts           # Config types and file I/O
    credentials.ts      # Credential detection from .env files
    env.ts              # .env file parser
    registry.ts         # Global project registry
    project-context.ts  # Project resolution logic
  db/                   # Database operations
    connection.ts       # Connection testing
    discovery.ts        # Table discovery
    dump.ts             # pg_dump wrapper
    restore.ts          # psql restore wrapper
  docker/               # Docker integration
    docker-check.ts     # Docker availability detection
    pg-tools.ts         # Docker/native execution layer
    local-db.ts         # Container lifecycle management
  storage/              # Storage sync
    supabase.ts         # Supabase Storage operations
    s3.ts               # S3-compatible operations
    sync.ts             # Storage sync orchestration
  ui/                   # Terminal UI helpers
    format.ts           # Chalk formatting utilities
    prompts.ts          # Confirmation prompts
```

## License

MIT
