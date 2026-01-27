import { execa } from 'execa';
import { createServer } from 'net';
import { testConnection } from '../db/connection.js';

export interface DockerDbConfig {
  managed: boolean;
  containerName: string;
  volumeName: string;
  port: number;
  image?: string;  // default 'postgres:16-alpine'
}

const DEFAULT_IMAGE = 'postgres:16-alpine';
const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * Find a free TCP port starting from a given number.
 */
export async function findFreePort(start = 54320): Promise<number> {
  // Try ports from start upward
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const server = createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error(`No free port found in range ${start}-${start + 99}`);
}

/**
 * Build a PostgreSQL connection URL for a Docker-managed database.
 */
export function connectionUrl(port: number): string {
  return `postgresql://postgres:postgres@localhost:${port}/postgres`;
}

/**
 * Check if a container with the given name is running.
 */
export async function isContainerRunning(name: string): Promise<boolean> {
  try {
    const result = await execa('docker', ['inspect', '--format', '{{.State.Running}}', name]);
    return (result.stdout as string).trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Check if a container with the given name exists (running or stopped).
 */
export async function containerExists(name: string): Promise<boolean> {
  try {
    await execa('docker', ['inspect', name], { stdout: 'ignore', stderr: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the host port mapped to container port 5432.
 */
async function getMappedPort(name: string): Promise<number | null> {
  try {
    const result = await execa('docker', ['port', name, '5432']);
    // Output like: 0.0.0.0:54320
    const match = (result.stdout as string).match(/:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Ensure a local Postgres Docker container is running.
 * Creates or starts the container as needed.
 * Returns the connection URL.
 */
export async function ensureLocalDb(config: DockerDbConfig): Promise<string> {
  const image = config.image || DEFAULT_IMAGE;

  // 1. Already running
  if (await isContainerRunning(config.containerName)) {
    const port = await getMappedPort(config.containerName) ?? config.port;
    return connectionUrl(port);
  }

  // 2. Exists but stopped — start it
  if (await containerExists(config.containerName)) {
    await execa('docker', ['start', config.containerName]);
    await waitForReady(config.port);
    return connectionUrl(config.port);
  }

  // 3. Create new container
  await execa('docker', [
    'run', '-d',
    '--name', config.containerName,
    '-v', `${config.volumeName}:/var/lib/postgresql/data`,
    '-p', `${config.port}:5432`,
    '-e', 'POSTGRES_PASSWORD=postgres',
    image,
  ]);

  await waitForReady(config.port);
  return connectionUrl(config.port);
}

/**
 * Wait until the database is ready to accept connections.
 */
async function waitForReady(port: number): Promise<void> {
  const url = connectionUrl(port);
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const result = await testConnection(url);
    if (result.connected) return;
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Local database did not become ready within ${MAX_WAIT_MS / 1000}s`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stop a running container.
 */
export async function stopLocalDb(name: string): Promise<void> {
  if (await isContainerRunning(name)) {
    await execa('docker', ['stop', name]);
  }
}

/**
 * Remove a container and optionally its volume.
 */
export async function removeLocalDb(name: string, volume: string): Promise<void> {
  if (await containerExists(name)) {
    await execa('docker', ['rm', '-f', name]);
  }
  try {
    await execa('docker', ['volume', 'rm', volume]);
  } catch {
    // Volume may not exist
  }
}

/**
 * Get the status of a Docker-managed database.
 */
export async function getLocalDbStatus(name: string): Promise<{
  exists: boolean;
  running: boolean;
  port: number | null;
}> {
  const exists = await containerExists(name);
  if (!exists) return { exists: false, running: false, port: null };

  const running = await isContainerRunning(name);
  const port = running ? await getMappedPort(name) : null;
  return { exists, running, port };
}
