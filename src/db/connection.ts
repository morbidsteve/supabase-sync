import { execa } from 'execa';

export interface ConnectionInfo {
  connected: boolean;
  version?: string;
  error?: string;
}

/**
 * Test database connectivity by running SELECT 1.
 */
export async function testConnection(connectionUrl: string): Promise<ConnectionInfo> {
  try {
    const result = await execa('psql', [
      connectionUrl,
      '--tuples-only',
      '--no-align',
      '-c', 'SELECT version();',
    ]);
    const version = result.stdout.trim().split(',')[0] || 'unknown';
    return { connected: true, version };
  } catch (err) {
    return { connected: false, error: String(err) };
  }
}

/**
 * Detect if a URL uses PgBouncer (Supabase pooler on port 6543).
 * pg_dump doesn't work through PgBouncer.
 */
export function isPooledUrl(url: string): boolean {
  return url.includes(':6543') || url.includes('pgbouncer=true');
}

/**
 * Warn if pg_dump version is older than the remote server.
 */
export async function checkPgDumpVersion(): Promise<string | null> {
  try {
    const result = await execa('pg_dump', ['--version']);
    // Output like: pg_dump (PostgreSQL) 16.1
    const match = result.stdout.match(/(\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if psql and pg_dump are available on PATH.
 */
export async function checkPrerequisites(): Promise<{ psql: boolean; pgDump: boolean }> {
  const [psqlResult, pgDumpResult] = await Promise.all([
    execa('which', ['psql']).then(() => true).catch(() => false),
    execa('which', ['pg_dump']).then(() => true).catch(() => false),
  ]);
  return { psql: psqlResult, pgDump: pgDumpResult };
}
