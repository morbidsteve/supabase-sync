import { execa, type Result } from 'execa';
import { dirname, basename } from 'path';
import { isDockerAvailable, resolveHostForDocker, getDockerNetworkArgs } from './docker-check.js';
import { isSupabaseDirectUrl } from '../core/supabase-url.js';

const DOCKER_IMAGE = 'postgres:17-alpine';

export type ExecutionMode = 'native' | 'docker';

let _cachedMode: ExecutionMode | null = null;

/**
 * Detect whether to use native psql/pg_dump or Docker.
 *
 * 1. If both psql and pg_dump are on PATH -> 'native'
 * 2. Else if Docker daemon is available  -> 'docker'
 * 3. Otherwise throw an error.
 */
export async function detectExecutionMode(): Promise<ExecutionMode> {
  // Check native tools
  const [hasPsql, hasPgDump] = await Promise.all([
    execa('which', ['psql']).then(() => true).catch(() => false),
    execa('which', ['pg_dump']).then(() => true).catch(() => false),
  ]);

  if (hasPsql && hasPgDump) {
    return 'native';
  }

  // Check Docker
  if (await isDockerAvailable()) {
    return 'docker';
  }

  throw new Error(
    'Neither psql/pg_dump nor Docker found. Install Docker (https://docker.com) or PostgreSQL client tools.',
  );
}

/**
 * Return the cached execution mode, detecting it on first call.
 */
export async function getExecutionMode(): Promise<ExecutionMode> {
  if (_cachedMode === null) {
    _cachedMode = await detectExecutionMode();
  }
  return _cachedMode;
}

/**
 * Execute psql with the given arguments.
 * In Docker mode, the connection URL is rewritten and files are volume-mounted.
 */
export async function execPsql(
  args: string[],
  options?: { reject?: boolean },
): Promise<Result> {
  const mode = await getExecutionMode();
  const reject = options?.reject ?? true;

  if (mode === 'native') {
    return execa('psql', args, { reject });
  }

  // Docker mode
  const { rewrittenArgs, volumeArgs, networkArgs } = prepareDockerArgs(args);

  return execa(
    'docker',
    ['run', '--rm', ...networkArgs, ...volumeArgs, DOCKER_IMAGE, 'psql', ...rewrittenArgs],
    { reject },
  );
}

/**
 * Execute pg_dump with the given arguments.
 * In Docker mode, the connection URL is rewritten and files are volume-mounted.
 * Always rejects on failure.
 */
export async function execPgDump(args: string[]): Promise<Result> {
  const mode = await getExecutionMode();

  if (mode === 'native') {
    return execa('pg_dump', args);
  }

  // Docker mode
  const { rewrittenArgs, volumeArgs, networkArgs } = prepareDockerArgs(args);

  return execa(
    'docker',
    ['run', '--rm', ...networkArgs, ...volumeArgs, DOCKER_IMAGE, 'pg_dump', ...rewrittenArgs],
  );
}

/**
 * Get the pg_dump version string, or null if unavailable.
 */
export async function execPgDumpVersion(): Promise<string | null> {
  try {
    const mode = await getExecutionMode();
    let result: Result;

    if (mode === 'native') {
      result = await execa('pg_dump', ['--version']);
    } else {
      result = await execa('docker', ['run', '--rm', DOCKER_IMAGE, 'pg_dump', '--version']);
    }

    // Output like: pg_dump (PostgreSQL) 16.1
    const match = (result.stdout as string).match(/(\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface DockerArgs {
  rewrittenArgs: string[];
  volumeArgs: string[];
  networkArgs: string[];
}

/**
 * Prepare Docker CLI arguments from a psql/pg_dump argument list:
 *  - Rewrite the connection URL for Docker networking
 *  - Mount host directories for --file arguments
 *  - Determine --network flags
 *  - Warn if a Supabase direct URL is used (IPv6-only, Docker can't reach it)
 */
function prepareDockerArgs(args: string[]): DockerArgs {
  const rewrittenArgs = [...args];
  let volumeArgs: string[] = [];

  // Find and rewrite the connection URL
  const urlIndex = rewrittenArgs.findIndex(
    a => a.startsWith('postgres://') || a.startsWith('postgresql://'),
  );
  const originalUrl = urlIndex !== -1 ? rewrittenArgs[urlIndex] : '';

  // Warn about Supabase direct URLs — these are IPv6-only and Docker can't reach them.
  // The init command should have converted these to pooler URLs, but warn just in case.
  if (urlIndex !== -1 && isSupabaseDirectUrl(rewrittenArgs[urlIndex])) {
    console.error(
      '\x1b[33m[warn]\x1b[0m Supabase direct URL detected (db.xxx.supabase.co). ' +
      'These use IPv6 which Docker cannot reach. Run `supabase-sync init` to reconfigure with the pooler URL.',
    );
  }

  if (urlIndex !== -1) {
    rewrittenArgs[urlIndex] = resolveHostForDocker(rewrittenArgs[urlIndex]);
  }

  // Find --file and set up volume mount
  const fileIndex = rewrittenArgs.indexOf('--file');
  if (fileIndex !== -1 && fileIndex + 1 < rewrittenArgs.length) {
    const filePath = rewrittenArgs[fileIndex + 1];
    const hostDir = dirname(filePath);
    const fileName = basename(filePath);
    volumeArgs = ['-v', `${hostDir}:/data`];
    rewrittenArgs[fileIndex + 1] = `/data/${fileName}`;
  }

  // Network args based on the ORIGINAL (unrewritten) URL
  const networkArgs = originalUrl ? getDockerNetworkArgs(originalUrl) : [];

  return { rewrittenArgs, volumeArgs, networkArgs };
}
