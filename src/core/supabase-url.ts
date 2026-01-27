/**
 * Supabase URL detection and rewriting.
 *
 * Supabase now uses IPv6-only for direct database connections (db.XXX.supabase.co).
 * Docker Desktop on macOS/Windows cannot route IPv6 traffic from containers.
 * The session-mode connection pooler (aws-0-REGION.pooler.supabase.com:5432)
 * uses IPv4 and works with pg_dump/psql in Docker containers.
 */

/**
 * Check if a URL is a Supabase direct connection URL.
 * These use the pattern: db.PROJECTREF.supabase.co
 */
export function isSupabaseDirectUrl(url: string): boolean {
  return /[@/]db\.[a-z0-9]+\.supabase\.co/.test(url);
}

/**
 * Extract the project ref from a Supabase database URL.
 *
 * Handles both formats:
 *   Direct: postgresql://postgres:pass@db.PROJECTREF.supabase.co:5432/postgres
 *   Pooler: postgresql://postgres.PROJECTREF:pass@aws-0-region.pooler.supabase.com:5432/postgres
 */
export function extractProjectRef(url: string): string | null {
  // Direct DB URL: db.PROJECTREF.supabase.co
  const dbMatch = url.match(/db\.([a-z0-9]+)\.supabase\.co/);
  if (dbMatch) return dbMatch[1];

  // Pooler URL: postgres.PROJECTREF:pass@
  const poolerMatch = url.match(/postgres\.([a-z0-9]+):/);
  if (poolerMatch) return poolerMatch[1];

  return null;
}

/**
 * Convert a Supabase direct connection URL to the session-mode pooler URL.
 *
 * Direct:  postgresql://postgres:PASSWORD@db.PROJECTREF.supabase.co:5432/postgres
 * Pooler:  postgresql://postgres.PROJECTREF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
 *
 * Session mode (port 5432) is used because pg_dump requires session-level
 * connection semantics. Transaction mode (port 6543) does NOT work with pg_dump.
 */
export function toPoolerUrl(directUrl: string, region: string): string | null {
  const ref = extractProjectRef(directUrl);
  if (!ref) return null;

  // Extract password: postgresql://user:PASSWORD@host
  const passMatch = directUrl.match(/:\/\/[^:]+:([^@]+)@/);
  if (!passMatch) return null;
  const password = passMatch[1];

  // Extract database name (default: postgres)
  const dbMatch = directUrl.match(/\/(\w+)(?:\?|$)/);
  const dbName = dbMatch ? dbMatch[1] : 'postgres';

  // Preserve query parameters if present
  const queryMatch = directUrl.match(/\?(.+)$/);
  const query = queryMatch ? `?${queryMatch[1]}` : '';

  return `postgresql://postgres.${ref}:${password}@aws-0-${region}.pooler.supabase.com:5432/${dbName}${query}`;
}

/**
 * If the given URL is a Supabase direct URL and a region is available,
 * convert to the pooler URL. Otherwise return the original URL unchanged.
 */
export function ensurePoolerUrl(url: string, region?: string): string {
  if (!region || !isSupabaseDirectUrl(url)) return url;
  return toPoolerUrl(url, region) ?? url;
}

/**
 * Known Supabase regions.
 */
export const SUPABASE_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'eu-central-2',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-2',
  'sa-east-1',
] as const;

/**
 * Auto-detect which Supabase region a project is in by probing the
 * session-mode pooler in each region concurrently.
 *
 * The correct region will either connect successfully or return a
 * "password authentication failed" error. Wrong regions return
 * "Tenant or user not found".
 *
 * Returns the detected region string, or null if detection fails.
 */
export async function detectRegion(directUrl: string): Promise<string | null> {
  const net = await import('net');
  const ref = extractProjectRef(directUrl);
  if (!ref) return null;

  // Extract password for the probe connection
  const passMatch = directUrl.match(/:\/\/[^:]+:([^@]+)@/);
  if (!passMatch) return null;
  const password = passMatch[1];

  /**
   * Try connecting to the pooler in a given region.
   * We open a raw TCP socket and send a PostgreSQL startup message.
   * We only need to see the server's first response to distinguish
   * "tenant not found" (wrong region) from anything else (right region).
   */
  async function probeRegion(region: string): Promise<string | null> {
    const host = `aws-0-${region}.pooler.supabase.com`;
    const port = 5432;
    const user = `postgres.${ref}`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, 5000);

      const socket = net.createConnection({ host, port }, () => {
        // Build a PostgreSQL startup message (protocol v3.0)
        const params = `user\0${user}\0database\0postgres\0\0`;
        const len = 4 + 4 + Buffer.byteLength(params, 'utf8');
        const buf = Buffer.alloc(len);
        buf.writeInt32BE(len, 0);
        buf.writeInt32BE(0x00030000, 4); // protocol 3.0
        buf.write(params, 8, 'utf8');
        socket.write(buf);
      });

      socket.on('data', (data: Buffer) => {
        clearTimeout(timeout);
        socket.destroy();

        // The server's response starts with a message type byte.
        // 'R' = Authentication request (correct region, project exists)
        // 'E' = Error (could be "tenant not found" = wrong region,
        //        or auth error = right region)
        const msgType = String.fromCharCode(data[0]);
        if (msgType === 'R') {
          // Auth request — right region
          resolve(region);
        } else if (msgType === 'E') {
          // Parse the error message
          const errText = data.toString('utf8', 5);
          if (errText.includes('Tenant or user not found')) {
            resolve(null); // wrong region
          } else {
            // Any other error (e.g. password wrong) means right region
            resolve(region);
          }
        } else {
          resolve(null);
        }
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  // Probe all regions in parallel
  const results = await Promise.all(
    SUPABASE_REGIONS.map((region) => probeRegion(region)),
  );

  return results.find((r) => r !== null) ?? null;
}
