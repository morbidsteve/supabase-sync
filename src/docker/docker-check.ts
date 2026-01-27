import { execa } from 'execa';

/**
 * Check if Docker is installed and the daemon is running.
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['info'], { stdout: 'ignore', stderr: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Map the Node.js process.platform to a simplified platform name.
 */
export function getPlatform(): 'macos' | 'linux' | 'windows' {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

/**
 * Rewrite localhost/127.0.0.1 in a PostgreSQL connection URL so that
 * a Docker container can reach the host machine.
 *
 * On macOS and Windows, Docker Desktop provides `host.docker.internal`.
 * On Linux, we leave the URL unchanged and rely on `--network host` instead.
 */
export function resolveHostForDocker(connectionUrl: string): string {
  const host = extractHost(connectionUrl);
  if (!host) return connectionUrl;

  if (host === 'localhost' || host === '127.0.0.1') {
    const platform = getPlatform();
    if (platform === 'macos' || platform === 'windows') {
      return connectionUrl.replace(`@${host}`, '@host.docker.internal');
    }
    // Linux: leave as-is; --network host handles it
  }

  return connectionUrl;
}

/**
 * Return extra Docker CLI arguments needed for networking.
 *
 * On Linux, when the connection targets localhost, we need `--network host`
 * so the container can reach the host's loopback interface.
 */
export function getDockerNetworkArgs(connectionUrl: string): string[] {
  const host = extractHost(connectionUrl);
  if (!host) return [];

  if (getPlatform() === 'linux' && (host === 'localhost' || host === '127.0.0.1')) {
    return ['--network', 'host'];
  }

  return [];
}

/**
 * Extract the host portion from a PostgreSQL connection URL.
 * Handles: postgresql://user:pass@HOST:PORT/dbname
 *          postgresql://user:pass@HOST/dbname
 */
function extractHost(url: string): string | null {
  const match = url.match(/@([^:/]+)/);
  return match ? match[1] : null;
}
