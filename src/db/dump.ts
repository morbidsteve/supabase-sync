import { execa } from 'execa';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getSnapshotDir } from '../core/config.js';

export function getDumpPath(): string {
  return join(getSnapshotDir(), 'dump.sql');
}

export interface DumpOptions {
  schemas: string[];
  excludeTables: string[];
  dumpFlags: string[];
}

/**
 * Dump a PostgreSQL database to .supabase-sync/dump.sql.
 * Uses pg_dump with configurable schema filters and flags.
 */
export async function dumpDatabase(
  connectionUrl: string,
  options: DumpOptions,
): Promise<string> {
  const snapshotDir = getSnapshotDir();
  if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });

  const dumpPath = getDumpPath();

  const args: string[] = [
    connectionUrl,
    '--format=plain',
    ...options.dumpFlags,
    '--file', dumpPath,
  ];

  // Add schema filters
  for (const schema of options.schemas) {
    args.push('--schema', schema);
  }

  // Add table exclusions
  for (const table of options.excludeTables) {
    args.push('--exclude-table', table);
  }

  await execa('pg_dump', args);

  return dumpPath;
}
