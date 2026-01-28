# supabase-sync — Project Context

## What This Is

A CLI tool for archiving and restoring Supabase projects to/from local Docker-managed Postgres databases. Solves the problem of Supabase's free tier limit (2 active projects) — archive a project locally, delete it from Supabase, and restore it later to a new project.

**Repo:** `github.com/morbidsteve/supabase-sync`
**Author:** Steven Katzman
**License:** MIT

## Tech Stack

- TypeScript (ESM, `"module": "NodeNext"`)
- Commander.js — CLI argument parsing
- Ink 5 + React 18 — full-screen TUI (interactive mode)
- chalk / ora / @inquirer/prompts — sequential CLI output (command mode)
- execa — subprocess execution (pg_dump, psql, Docker)
- Docker — runs pg_dump/psql in `postgres:17-alpine` containers, manages local Postgres containers

## Architecture

```
src/
├── index.ts              # Entry point: CLI args → Commander, no args → Ink TUI
├── commands/             # CLI-mode command implementations (chalk/ora output)
│   ├── init.ts           # Project initialization wizard
│   ├── pull.ts           # Cloud → Local sync
│   ├── push.ts           # Local → Cloud sync
│   ├── preview.ts        # Dry run preview
│   ├── status.ts         # Connection & data status
│   └── settings.ts       # Configuration management
├── tui/                  # Full-screen TUI (Ink/React) — launched when no args
│   ├── App.tsx           # Root component, screen router
│   ├── types.ts          # Screen, TaskStatus, TaskStep types
│   ├── hooks/
│   │   ├── useNavigation.ts   # Screen stack navigation
│   │   └── useAsyncTask.ts    # Multi-step async operation tracker
│   ├── components/
│   │   ├── Layout.tsx         # Full-screen shell (Header + content + Footer)
│   │   ├── Header.tsx         # App title + project name + screen title
│   │   ├── Footer.tsx         # Keybinding hints
│   │   ├── StepList.tsx       # Spinner/checkmark step list (replaces ora)
│   │   ├── StatusLine.tsx     # Label:value row
│   │   └── ConfirmPrompt.tsx  # Inline y/n confirmation
│   └── screens/
│       ├── MenuScreen.tsx     # Main menu (ink-select-input)
│       ├── StatusScreen.tsx   # Connection status + table counts
│       ├── PullScreen.tsx     # Cloud → Local with progress
│       ├── PushScreen.tsx     # Local → Cloud with destructive warning
│       ├── PreviewScreen.tsx  # Dry run display
│       ├── SettingsScreen.tsx # Config submenu with forms
│       └── InitScreen.tsx     # Multi-step setup wizard
├── core/                 # Configuration and utilities
│   ├── config.ts         # SyncConfig types, load/save from .supabase-sync.json
│   ├── credentials.ts    # Auto-detect creds from .env files
│   ├── env.ts            # .env file parser
│   ├── supabase-url.ts   # URL rewriting, region detection, direct→pooler conversion
│   ├── registry.ts       # Global project registry (~/.supabase-sync/projects.json)
│   └── project-context.ts # Project resolution (by ID, default, or interactive)
├── db/                   # Database operations
│   ├── connection.ts     # testConnection(), checkPrerequisites()
│   ├── discovery.ts      # getTableCounts()
│   ├── dump.ts           # dumpDatabase() via pg_dump
│   └── restore.ts        # restoreDatabase() via psql
├── docker/               # Docker integration
│   ├── docker-check.ts   # isDockerAvailable(), resolveHostForDocker()
│   ├── pg-tools.ts       # execPsql(), execPgDump() — native or Docker
│   └── local-db.ts       # Container lifecycle: ensureLocalDb(), stopLocalDb(), etc.
├── storage/              # Storage sync
│   ├── supabase.ts       # Supabase Storage operations
│   ├── s3.ts             # S3-compatible local storage (MinIO)
│   └── sync.ts           # pullStorage(), pushStorage()
└── ui/                   # CLI-mode formatting (used by src/commands/)
    ├── format.ts         # header(), success(), warn(), error(), tableRow()
    └── prompts.ts        # confirmAction(), confirmDestructive()
```

## Key Design Decisions

- **Two UI modes:** CLI mode (`supabase-sync pull -y`) uses chalk/ora for sequential output. Interactive mode (`supabase-sync` with no args) launches full-screen Ink TUI in alternate screen buffer. React/Ink are dynamically imported so CLI mode stays fast.
- **Docker-first:** pg_dump and psql run inside `postgres:17-alpine` Docker containers. Falls back to native tools if available. No host PostgreSQL installation needed.
- **IPv6 workaround:** Supabase direct database URLs (`db.xxx.supabase.co`) are IPv6-only, which Docker on macOS can't reach. The tool auto-converts these to the IPv4 connection pooler URL.
- **Per-directory config:** `.supabase-sync.json` in the project directory stores credentials, sync options, Docker config, and last sync metadata.
- **Global registry:** `~/.supabase-sync/projects.json` stores project entries. Code exists but is NOT fully wired into commands (commands still use per-directory config).

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # TypeScript compilation (tsc)
pnpm dev              # Run via tsx (development)
pnpm start            # Run compiled dist/index.js
```

## Testing the tool

The tool is globally linked (`pnpm link --global`), so `supabase-sync` is available system-wide.

Test project config is at `/Users/steven/programming/circuitmap/.supabase-sync.json` — this is the CircuitMap project (`gpkvobeechnkbgzioipb`, region `us-west-2`). The local Docker container is `supabase-sync-pg-1769545806436` on port 54320.

To test: `cd /Users/steven/programming/circuitmap && supabase-sync`

---

# Completed Work

## Phase 1: Core CLI Tool (Complete)
- pg_dump/psql execution via Docker containers
- Docker-managed local Postgres (auto-provisioned, persistent storage)
- Pull (cloud → local) and Push (local → cloud) with confirmation
- Status command showing connections, table counts, Docker info
- Preview (dry run) command
- Settings management (credentials, sync options, Docker)
- Init wizard (auto-detect .env credentials, Docker setup)
- Storage sync (Supabase Storage + S3/MinIO)
- IPv6 → IPv4 pooler URL auto-conversion

## Phase 2: Multi-Project Registry (Partially Complete)
- `registry.ts` and `project-context.ts` exist with full CRUD
- Interactive menu shows project name and "Switch Project" option
- **NOT DONE:** Commands still use per-directory config, not the registry

## Phase 3: Polish for Public Release (Complete)
- README rewrite with feature list, CLI reference, project structure
- MIT LICENSE file
- package.json metadata (author, repository, keywords, files)
- Replaced raw ANSI codes with chalk in pg-tools.ts
- Demo GIF in README (synthetic recording showing status/pull/push)

## Phase 4: Full-Screen TUI (Complete)
- Ink 5 + React 18 with alternate screen buffer
- 6 shared components (Layout, Header, Footer, StepList, StatusLine, ConfirmPrompt)
- 7 screens (Menu, Status, Pull, Push, Preview, Settings, Init)
- Navigation stack with Escape to go back, q to quit
- Console output suppressed during TUI mode
- CLI mode unchanged (regression-safe)

## Verified End-to-End
- `supabase-sync init` → creates config + Docker container
- `supabase-sync pull` → dumps cloud DB via Docker pg_dump, restores to local Docker Postgres
- `supabase-sync push` → dumps local, restores to cloud (tested against CircuitMap project)
- Round-trip: pull → verify locally → push back = 129 rows, all matching

---

# Next Phases

## Phase 5: Security & Quality (HIGH PRIORITY)

### 5a. Credential masking in error output
The status command leaks the full database URL (with password) in Docker error messages. When `execPsql` fails, the error includes the raw connection string. Need to sanitize connection strings in all error output paths.

**Files:** `src/docker/pg-tools.ts`, `src/db/connection.ts`
**Approach:** Create a `sanitizeUrl(url)` utility that masks the password portion of postgres:// URLs. Apply it in error messages and any place URLs are logged.

### 5b. Tests
Zero tests exist. Add:
- Unit tests for `core/supabase-url.ts` (URL rewriting, region detection, pooler conversion)
- Unit tests for `core/config.ts` (load/save, defaults)
- Unit tests for `docker/pg-tools.ts` (argument preparation, Docker args)
- Integration test for `db/dump.ts` + `db/restore.ts` (requires Docker)

**Framework:** Vitest (already in CircuitMap, consistent)

### 5c. GitHub Actions CI
Basic workflow: install → build → lint → test on push/PR.

### 5d. npm publish
The package is ready (files field, metadata). Just needs `npm publish`. Consider adding a GitHub Action for automated publishing on tags.

## Phase 6: Wire Up Multi-Project Registry (MEDIUM PRIORITY)

The registry code exists but commands don't use it. This is the difference between "backup one project" and "manage all your Supabase projects."

### 6a. Update all commands to use resolveProjectContext()
Each command should call `resolveProjectContext()` instead of `loadConfig()`. This resolves the project from: `--project` flag → default project → interactive selection → legacy config migration.

**Files:** All 6 command files + init.ts
**Pattern:**
```typescript
const ctx = await resolveProjectContext({ projectId, interactive: true });
const { project, snapshotDir, storageDir } = ctx;
// Use project.cloud, project.local, project.sync instead of config
```

### 6b. Refactor dump/restore to accept paths
Currently use `getSnapshotDir()` which reads from cwd. Change to accept explicit `snapshotDir` parameter so each project stores snapshots in `~/.supabase-sync/projects/{id}/snapshots/`.

**Files:** `src/db/dump.ts`, `src/db/restore.ts`, `src/storage/sync.ts`

### 6c. Legacy config migration
When a user has an old `.supabase-sync.json` in their directory, offer to migrate it into the global registry.

### 6d. Update TUI screens for multi-project
The TUI screens should also use `resolveProjectContext()`. Currently they use `configExists()`/`loadConfig()`.

## Phase 7: Snapshot History (MEDIUM PRIORITY)

Keep timestamped dumps instead of overwriting. Let users list and restore from specific snapshots.

### 7a. Timestamped snapshot filenames
Change dump output from `dump.sql` to `dump-YYYY-MM-DDTHH-MM-SS.sql`. Store in project snapshot directory.

### 7b. `supabase-sync snapshots` command
List available snapshots with timestamps and sizes. Allow restoring from a specific snapshot.

### 7c. Snapshot pruning
Auto-delete snapshots older than N days or keep only the last N snapshots. Configurable in settings.

## Phase 8: Advanced Features (LOWER PRIORITY)

### 8a. `supabase-sync diff`
Compare cloud vs local — show which tables have different row counts, which are missing on either side.

### 8b. Selective table sync
`supabase-sync pull --tables users,posts` — only sync specific tables.

### 8c. Progress bars
Pipe pg_dump/psql output and show real progress during large dumps/restores.

### 8d. Homebrew formula
Create a Homebrew tap for `brew install supabase-sync`.

### 8e. Shell completions
Bash/zsh completions for commands and --project flag.

## Phase 9: Distribution (LOWER PRIORITY)

### 9a. npm publish automation
GitHub Action that publishes to npm on version tag push.

### 9b. Homebrew tap
`homebrew-supabase-sync` repo with formula.

### 9c. Update demo GIF
Re-record the asciinema demo with the actual full-screen TUI instead of the synthetic CLI recording.

---

# Other Project: CircuitMap

The CircuitMap Next.js app at `/Users/steven/programming/circuitmap` has a performance issue — slow page loads likely caused by unoptimized database queries. This is separate from supabase-sync but was mentioned. The Supabase project for CircuitMap is `gpkvobeechnkbgzioipb` (us-west-2).
