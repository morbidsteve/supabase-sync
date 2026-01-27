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
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'ca-central-1', label: 'Canada (Central)' },
  { value: 'eu-west-1', label: 'EU West (Ireland)' },
  { value: 'eu-west-2', label: 'EU West (London)' },
  { value: 'eu-west-3', label: 'EU West (Paris)' },
  { value: 'eu-central-1', label: 'EU Central (Frankfurt)' },
  { value: 'eu-central-2', label: 'EU Central (Zurich)' },
  { value: 'eu-north-1', label: 'EU North (Stockholm)' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'sa-east-1', label: 'South America (Sao Paulo)' },
] as const;
