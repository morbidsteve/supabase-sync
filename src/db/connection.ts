import { execPsql, execPgDumpVersion, getExecutionMode } from '../docker/pg-tools.js';
import { isDockerAvailable } from '../docker/docker-check.js';

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
    const result = await execPsql([
      connectionUrl,
      '--tuples-only',
      '--no-align',
      '-c', 'SELECT version();',
    ]);
    const version = (result.stdout as string).trim().split(',')[0] || 'unknown';
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
  return execPgDumpVersion();
}

/**
 * Check if psql and pg_dump are available (natively or via Docker).
 */
export async function checkPrerequisites(): Promise<{
  mode: 'native' | 'docker' | 'none';
  psql: boolean;
  pgDump: boolean;
  dockerAvailable: boolean;
}> {
  try {
    const mode = await getExecutionMode();
    const dockerAvailable = mode === 'docker' ? true : await isDockerAvailable();
    return {
      mode,
      psql: true,
      pgDump: true,
      dockerAvailable,
    };
  } catch {
    // Neither native tools nor Docker available
    const dockerAvailable = await isDockerAvailable();
    return {
      mode: 'none',
      psql: false,
      pgDump: false,
      dockerAvailable,
    };
  }
}
