import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface CloudCredentials {
  projectUrl: string;
  databaseUrl: string;
  anonKey: string;
  serviceRoleKey?: string;
}

export interface LocalCredentials {
  databaseUrl: string;
}

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  forcePathStyle?: boolean;
}

export interface SyncOptions {
  schemas: string[];
  excludeTables: string[];
  dumpOptions: string[];
}

export interface SyncMetadata {
  type: 'pull' | 'push';
  timestamp: string;
  tables: number;
  rows: number;
  files: number;
}

export interface DockerConfig {
  managed: boolean;
  containerName: string;
  volumeName: string;
  port: number;
  image?: string;
}

export interface SyncConfig {
  version: number;
  cloud?: CloudCredentials;
  local?: LocalCredentials;
  docker?: DockerConfig;
  storage?: {
    enabled: boolean;
    localS3?: S3Config;
  };
  sync: SyncOptions;
  lastSync?: SyncMetadata;
}

const CONFIG_FILENAME = '.supabase-sync.json';

export function getConfigPath(): string {
  return join(process.cwd(), CONFIG_FILENAME);
}

export function getSnapshotDir(): string {
  return join(process.cwd(), '.supabase-sync');
}

export function configExists(): boolean {
  return existsSync(getConfigPath());
}

export function loadConfig(): SyncConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return defaultConfig();
  }
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: SyncConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function defaultConfig(): SyncConfig {
  return {
    version: 1,
    sync: {
      schemas: ['public'],
      excludeTables: ['_prisma_migrations', 'schema_migrations'],
      dumpOptions: ['--clean', '--if-exists', '--no-owner', '--no-privileges'],
    },
  };
}
