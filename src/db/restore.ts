import { execPsql } from '../docker/pg-tools.js';
import { existsSync } from 'fs';
import { getDumpPath } from './dump.js';

/**
 * Restore a SQL dump to a PostgreSQL database.
 * Uses psql with --single-transaction for atomicity.
 * If dumpPath is not provided, uses the default snapshot directory.
 */
export async function restoreDatabase(connectionUrl: string, dumpPath?: string): Promise<void> {
  const filePath = dumpPath ?? getDumpPath();
  if (!existsSync(filePath)) {
    throw new Error(`No dump file found at ${filePath}`);
  }

  await execPsql([
    connectionUrl,
    '--single-transaction',
    '--file', filePath,
  ], {
    // psql emits notices about DROP IF EXISTS — these are harmless
    reject: false,
  });
}
