import { execPgDump } from '../docker/pg-tools.js';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getSnapshotDir } from '../core/config.js';

export interface DumpOptions {
  schemas: string[];
  excludeTables: string[];
  dumpFlags: string[];
  snapshotDir?: string;
}

/**
 * Get the dump file path for a given snapshot directory.
 */
export function getDumpPath(snapshotDir?: string): string {
  return join(snapshotDir ?? getSnapshotDir(), 'dump.sql');
}

/**
 * Dump a PostgreSQL database to a dump.sql file.
 * Uses pg_dump with configurable schema filters and flags.
 */
export async function dumpDatabase(
  connectionUrl: string,
  options: DumpOptions,
): Promise<string> {
  const dir = options.snapshotDir ?? getSnapshotDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dumpPath = getDumpPath(dir);

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

  await execPgDump(args);

  return dumpPath;
}
