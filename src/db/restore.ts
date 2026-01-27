import { execa } from 'execa';
import { existsSync } from 'fs';
import { getDumpPath } from './dump.js';

/**
 * Restore a SQL dump to a PostgreSQL database.
 * Uses psql with --single-transaction for atomicity.
 */
export async function restoreDatabase(connectionUrl: string): Promise<void> {
  const dumpPath = getDumpPath();
  if (!existsSync(dumpPath)) {
    throw new Error(`No dump file found at ${dumpPath}`);
  }

  await execa('psql', [
    connectionUrl,
    '--single-transaction',
    '--file', dumpPath,
  ], {
    // psql emits notices about DROP IF EXISTS — these are harmless
    reject: false,
  });
}
