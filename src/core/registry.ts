import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { CloudCredentials, LocalCredentials, S3Config, SyncOptions, SyncMetadata, DockerConfig } from './config.js';

export interface ProjectEntry {
  id: string;                    // slug (e.g. "my-project")
  name: string;                  // display name
  cloud?: CloudCredentials;
  local?: LocalCredentials;
  docker?: DockerConfig;
  storage?: { enabled: boolean; localS3?: S3Config };
  sync: SyncOptions;
  lastSync?: SyncMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface Registry {
  version: 1;
  projects: Record<string, ProjectEntry>;
  defaultProject?: string;
}

function getRegistryDir(): string {
  return join(homedir(), '.supabase-sync');
}

function getRegistryPath(): string {
  return join(getRegistryDir(), 'projects.json');
}

export function getProjectDataDir(projectId: string): string {
  return join(getRegistryDir(), 'projects', projectId);
}

export function getProjectSnapshotDir(projectId: string): string {
  return join(getProjectDataDir(projectId), 'snapshots');
}

export function getProjectStorageDir(projectId: string): string {
  return join(getProjectDataDir(projectId), 'storage');
}

function ensureRegistryDir(): void {
  const dir = getRegistryDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function registryExists(): boolean {
  return existsSync(getRegistryPath());
}

export function loadRegistry(): Registry {
  if (!registryExists()) {
    return { version: 1, projects: {} };
  }
  try {
    const raw = readFileSync(getRegistryPath(), 'utf-8');
    return JSON.parse(raw) as Registry;
  } catch {
    return { version: 1, projects: {} };
  }
}

export function saveRegistry(registry: Registry): void {
  ensureRegistryDir();
  writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

export function listProjects(): ProjectEntry[] {
  const registry = loadRegistry();
  return Object.values(registry.projects);
}

export function getProject(id: string): ProjectEntry | null {
  const registry = loadRegistry();
  return registry.projects[id] ?? null;
}

export function addProject(entry: ProjectEntry): void {
  const registry = loadRegistry();
  if (registry.projects[entry.id]) {
    throw new Error(`Project "${entry.id}" already exists`);
  }
  registry.projects[entry.id] = entry;
  if (!registry.defaultProject) {
    registry.defaultProject = entry.id;
  }
  saveRegistry(registry);

  // Ensure data directories exist
  const dataDir = getProjectDataDir(entry.id);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const snapshotDir = getProjectSnapshotDir(entry.id);
  if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });
  const storageDir = getProjectStorageDir(entry.id);
  if (!existsSync(storageDir)) mkdirSync(storageDir, { recursive: true });
}

export function updateProject(id: string, updates: Partial<ProjectEntry>): void {
  const registry = loadRegistry();
  const existing = registry.projects[id];
  if (!existing) {
    throw new Error(`Project "${id}" not found`);
  }
  registry.projects[id] = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  saveRegistry(registry);
}

export function removeProject(id: string): void {
  const registry = loadRegistry();
  if (!registry.projects[id]) {
    throw new Error(`Project "${id}" not found`);
  }
  delete registry.projects[id];
  if (registry.defaultProject === id) {
    const remaining = Object.keys(registry.projects);
    registry.defaultProject = remaining.length > 0 ? remaining[0] : undefined;
  }
  saveRegistry(registry);
}

export function getDefaultProject(): ProjectEntry | null {
  const registry = loadRegistry();
  if (!registry.defaultProject) return null;
  return registry.projects[registry.defaultProject] ?? null;
}

export function setDefaultProject(id: string): void {
  const registry = loadRegistry();
  if (!registry.projects[id]) {
    throw new Error(`Project "${id}" not found`);
  }
  registry.defaultProject = id;
  saveRegistry(registry);
}

/**
 * Migrate a legacy per-directory .supabase-sync.json config into the global registry.
 * Returns the new ProjectEntry, or null if no legacy config exists.
 */
export function migrateLegacyConfig(cwd: string, projectName: string): ProjectEntry | null {
  const legacyConfigPath = join(cwd, '.supabase-sync.json');
  if (!existsSync(legacyConfigPath)) return null;

  try {
    const raw = readFileSync(legacyConfigPath, 'utf-8');
    const legacy = JSON.parse(raw);
    const id = slugify(projectName);
    const now = new Date().toISOString();

    const entry: ProjectEntry = {
      id,
      name: projectName,
      cloud: legacy.cloud,
      local: legacy.local,
      docker: legacy.docker,
      storage: legacy.storage,
      sync: legacy.sync ?? {
        schemas: ['public'],
        excludeTables: [],
        dumpOptions: ['--clean', '--if-exists', '--no-owner', '--no-privileges'],
      },
      lastSync: legacy.lastSync,
      createdAt: now,
      updatedAt: now,
    };

    addProject(entry);

    // Copy snapshot data if it exists
    const legacySnapshotDir = join(cwd, '.supabase-sync');
    const newSnapshotDir = getProjectSnapshotDir(id);
    if (existsSync(legacySnapshotDir)) {
      try {
        for (const file of readdirSync(legacySnapshotDir)) {
          const srcPath = join(legacySnapshotDir, file);
          const destPath = join(newSnapshotDir, file);
          copyFileSync(srcPath, destPath);
        }
      } catch {
        // Non-critical: snapshot copy failure
      }
    }

    return entry;
  } catch {
    return null;
  }
}

/**
 * Generate a URL-safe slug from a display name.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
