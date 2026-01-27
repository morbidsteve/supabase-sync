import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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
 * Generate a URL-safe slug from a display name.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
