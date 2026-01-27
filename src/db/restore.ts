import { execPsql } from '../docker/pg-tools.js';
import { existsSync } from 'fs';
import { getDumpPath } from './dump.js';

/**
 * Restore a SQL dump to a PostgreSQL database.
 *
 * We intentionally do NOT use --single-transaction because Supabase dumps
 * include cross-schema FK constraints (e.g. auth.saml_relay_states ->
 * auth.flow_state) where the referenced table may be excluded. Those FK
 * errors are harmless, but --single-transaction would roll back the
 * entire restore on the first one.
 *
 * If dumpPath is not provided, uses the default snapshot directory.
 */
export async function restoreDatabase(connectionUrl: string, dumpPath?: string): Promise<void> {
  const filePath = dumpPath ?? getDumpPath();
  if (!existsSync(filePath)) {
    throw new Error(`No dump file found at ${filePath}`);
  }

  await execPsql([
    connectionUrl,
    '--file', filePath,
  ], {
    // psql emits notices and non-fatal FK errors for excluded tables — harmless
    reject: false,
  });
}
