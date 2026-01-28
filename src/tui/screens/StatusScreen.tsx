import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { StepList } from '../components/StepList.js';
import { StatusLine } from '../components/StatusLine.js';
import type { TaskStep } from '../types.js';
import { configExists, loadConfig } from '../../core/config.js';
import { testConnection } from '../../db/connection.js';
import { getTableCounts, type TableInfo } from '../../db/discovery.js';
import { getLocalDbStatus, ensureLocalDb } from '../../docker/local-db.js';
import { ensurePoolerUrl } from '../../core/supabase-url.js';

interface StatusScreenProps {
  onBack: () => void;
}

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'failed';
type DockerState = 'idle' | 'checking' | 'starting' | 'running' | 'stopped' | 'not_created' | 'failed';

export function StatusScreen({ onBack }: StatusScreenProps) {
  const [phase, setPhase] = useState<'loading' | 'done'>('loading');
  const [hasConfig, setHasConfig] = useState(false);

  // Cloud state
  const [cloudStatus, setCloudStatus] = useState<ConnectionStatus>('idle');
  const [cloudVersion, setCloudVersion] = useState('');
  const [cloudTables, setCloudTables] = useState<TableInfo[]>([]);
  const [cloudError, setCloudError] = useState('');
  const [cloudTablesLoading, setCloudTablesLoading] = useState(false);

  // Docker state
  const [dockerState, setDockerState] = useState<DockerState>('idle');
  const [dockerContainerName, setDockerContainerName] = useState('');
  const [dockerPort, setDockerPort] = useState<number | null>(null);

  // Local state
  const [localStatus, setLocalStatus] = useState<ConnectionStatus>('idle');
  const [localVersion, setLocalVersion] = useState('');
  const [localTables, setLocalTables] = useState<TableInfo[]>([]);
  const [localError, setLocalError] = useState('');
  const [localTablesLoading, setLocalTablesLoading] = useState(false);

  // Config-derived state
  const [mode, setMode] = useState('');
  const [hasCloud, setHasCloud] = useState(false);
  const [hasDocker, setHasDocker] = useState(false);
  const [lastSync, setLastSync] = useState<{
    type: 'pull' | 'push';
    timestamp: string;
    tables: number;
    rows: number;
    files: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!configExists()) {
        setHasConfig(false);
        setPhase('done');
        return;
      }

      setHasConfig(true);
      const config = loadConfig();

      // Auto-convert Supabase direct URLs to pooler URLs if region is known
      if (config.cloud?.region) {
        config.cloud.databaseUrl = ensurePoolerUrl(config.cloud.databaseUrl, config.cloud.region);
      }

      const cloudConfigured = !!config.cloud;
      const initialHasLocal = !!config.local || !!config.docker?.managed;
      setHasCloud(cloudConfigured);
      setHasDocker(!!config.docker?.managed);
      setLastSync(config.lastSync ?? null);

      const modeLabel = cloudConfigured && initialHasLocal
        ? 'Cloud + Local'
        : cloudConfigured
          ? 'Cloud only'
          : 'Local only';
      setMode(modeLabel);

      // --- Cloud connection test ---
      if (cloudConfigured) {
        setCloudStatus('testing');
        try {
          const conn = await testConnection(config.cloud!.databaseUrl);
          if (cancelled) return;

          if (conn.connected) {
            setCloudStatus('connected');
            setCloudVersion(conn.version || '');

            // Fetch cloud tables
            setCloudTablesLoading(true);
            try {
              const tables = await getTableCounts(
                config.cloud!.databaseUrl,
                config.sync.schemas,
                config.sync.excludeTables,
              );
              if (cancelled) return;
              setCloudTables(tables);
            } catch {
              // Table fetch failed silently — we still show connected
            }
            setCloudTablesLoading(false);
          } else {
            setCloudStatus('failed');
            setCloudError(conn.error?.split('\n')[0] || 'Connection failed');
          }
        } catch (err) {
          if (cancelled) return;
          setCloudStatus('failed');
          setCloudError(String(err));
        }
      }

      // --- Docker section ---
      if (config.docker?.managed) {
        setDockerContainerName(config.docker.containerName);
        setDockerState('checking');

        try {
          const dbStatus = await getLocalDbStatus(config.docker.containerName);
          if (cancelled) return;

          if (dbStatus.running) {
            setDockerState('running');
            setDockerPort(dbStatus.port);
            if (!config.local) {
              config.local = {
                databaseUrl: `postgresql://postgres:postgres@localhost:${dbStatus.port}/postgres`,
              };
            }
          } else if (dbStatus.exists) {
            setDockerState('stopped');

            // Auto-start if not running
            setDockerState('starting');
            try {
              const url = await ensureLocalDb(config.docker);
              if (cancelled) return;
              config.local = { databaseUrl: url };
              setDockerState('running');
              setDockerPort(config.docker.port);
            } catch {
              if (cancelled) return;
              setDockerState('failed');
            }
          } else {
            setDockerState('not_created');

            // Try to create and start
            setDockerState('starting');
            try {
              const url = await ensureLocalDb(config.docker);
              if (cancelled) return;
              config.local = { databaseUrl: url };
              setDockerState('running');
              setDockerPort(config.docker.port);
            } catch {
              if (cancelled) return;
              setDockerState('failed');
            }
          }
        } catch {
          if (cancelled) return;
          setDockerState('failed');
        }
      }

      // --- Local connection test ---
      if (config.local) {
        setLocalStatus('testing');
        try {
          const conn = await testConnection(config.local.databaseUrl);
          if (cancelled) return;

          if (conn.connected) {
            setLocalStatus('connected');
            setLocalVersion(conn.version || '');

            // Fetch local tables
            setLocalTablesLoading(true);
            try {
              const tables = await getTableCounts(
                config.local.databaseUrl,
                config.sync.schemas,
                config.sync.excludeTables,
              );
              if (cancelled) return;
              setLocalTables(tables);
            } catch {
              // Table fetch failed silently
            }
            setLocalTablesLoading(false);
          } else {
            setLocalStatus('failed');
            setLocalError(conn.error?.split('\n')[0] || 'Connection failed');
          }
        } catch (err) {
          if (cancelled) return;
          setLocalStatus('failed');
          setLocalError(String(err));
        }
      }

      setPhase('done');
    }

    run();
    return () => { cancelled = true; };
  }, []);

  // --- No config ---
  if (phase === 'done' && !hasConfig) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No configuration found.</Text>
        <Text dimColor>Run init to set up your project.</Text>
      </Box>
    );
  }

  // --- Build step lists ---
  const cloudSteps: TaskStep[] = [];
  if (hasCloud) {
    if (cloudStatus === 'testing') {
      cloudSteps.push({ label: 'Testing cloud connection...', status: 'running' });
    } else if (cloudStatus === 'connected') {
      cloudSteps.push({
        label: 'Cloud database connected',
        status: 'success',
        detail: cloudVersion,
      });
      if (cloudTablesLoading) {
        cloudSteps.push({ label: 'Fetching table counts...', status: 'running' });
      }
    } else if (cloudStatus === 'failed') {
      cloudSteps.push({
        label: 'Cloud database connection failed',
        status: 'error',
        detail: cloudError,
      });
    }
  }

  const dockerSteps: TaskStep[] = [];
  if (hasDocker) {
    if (dockerState === 'checking') {
      dockerSteps.push({ label: 'Checking Docker container...', status: 'running' });
    } else if (dockerState === 'starting') {
      dockerSteps.push({ label: 'Starting local database...', status: 'running' });
    } else if (dockerState === 'failed') {
      dockerSteps.push({ label: 'Failed to start local database', status: 'error' });
    } else if (dockerState === 'running') {
      dockerSteps.push({ label: 'Local database running', status: 'success' });
    }
  }

  const localSteps: TaskStep[] = [];
  if (localStatus === 'testing') {
    localSteps.push({ label: 'Testing local connection...', status: 'running' });
  } else if (localStatus === 'connected') {
    localSteps.push({
      label: 'Local database connected',
      status: 'success',
      detail: localVersion,
    });
    if (localTablesLoading) {
      localSteps.push({ label: 'Fetching table counts...', status: 'running' });
    }
  } else if (localStatus === 'failed') {
    localSteps.push({
      label: 'Local database connection failed',
      status: 'error',
      detail: localError,
    });
  }

  // --- Compute totals ---
  const cloudTotalRows = cloudTables.reduce((sum, t) => sum + t.rowCount, 0);
  const localTotalRows = localTables.reduce((sum, t) => sum + t.rowCount, 0);

  return (
    <Box flexDirection="column">
      {/* Mode line */}
      {mode && (
        <Box marginBottom={1}>
          <Text dimColor>Mode: </Text>
          <Text>{mode}</Text>
        </Box>
      )}

      {/* Cloud Database section */}
      {hasCloud && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Cloud Database</Text>
          <StepList steps={cloudSteps} />
          {cloudStatus === 'connected' && !cloudTablesLoading && cloudTables.length > 0 && (
            <Box flexDirection="column" marginTop={0}>
              {cloudTables.map((t) => (
                <StatusLine
                  key={`${t.schema}.${t.name}`}
                  label={`${t.schema}.${t.name}`}
                  value={`~${t.rowCount} rows`}
                  pad={30}
                />
              ))}
              <Box paddingLeft={2}>
                <Text dimColor>{'─'.repeat(40)}</Text>
              </Box>
              <StatusLine
                label="Total"
                value={`${cloudTables.length} tables, ~${cloudTotalRows} rows`}
                pad={30}
              />
            </Box>
          )}
          {cloudStatus === 'connected' && !cloudTablesLoading && cloudTables.length === 0 && (
            <Box paddingLeft={2}>
              <Text dimColor>No tables found</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Docker Database section */}
      {hasDocker && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Docker Database</Text>
          <StepList steps={dockerSteps} />
          {dockerState === 'running' && (
            <Box flexDirection="column">
              <StatusLine label="Container" value={dockerContainerName} />
              <StatusLine label="Status" value="running" />
              {dockerPort && <StatusLine label="Port" value={String(dockerPort)} />}
            </Box>
          )}
        </Box>
      )}

      {/* Local Database section */}
      {(localStatus !== 'idle') && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Local Database</Text>
          <StepList steps={localSteps} />
          {localStatus === 'connected' && !localTablesLoading && localTables.length > 0 && (
            <Box flexDirection="column" marginTop={0}>
              {localTables.map((t) => (
                <StatusLine
                  key={`${t.schema}.${t.name}`}
                  label={`${t.schema}.${t.name}`}
                  value={`~${t.rowCount} rows`}
                  pad={30}
                />
              ))}
              <Box paddingLeft={2}>
                <Text dimColor>{'─'.repeat(40)}</Text>
              </Box>
              <StatusLine
                label="Total"
                value={`${localTables.length} tables, ~${localTotalRows} rows`}
                pad={30}
              />
            </Box>
          )}
          {localStatus === 'connected' && !localTablesLoading && localTables.length === 0 && (
            <Box paddingLeft={2}>
              <Text dimColor>No tables found</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Not configured messages */}
      {!hasCloud && phase === 'done' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Cloud Database</Text>
          <Box paddingLeft={2}>
            <Text dimColor>Not configured</Text>
          </Box>
        </Box>
      )}

      {localStatus === 'idle' && !hasDocker && phase === 'done' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Local Database</Text>
          <Box paddingLeft={2}>
            <Text dimColor>Not configured</Text>
          </Box>
        </Box>
      )}

      {/* Last Sync section */}
      {phase === 'done' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Last Sync</Text>
          {lastSync ? (
            <Box flexDirection="column">
              <StatusLine
                label="Direction"
                value={lastSync.type === 'pull' ? 'Pull (cloud -> local)' : 'Push (local -> cloud)'}
              />
              <StatusLine label="Timestamp" value={lastSync.timestamp} />
              <StatusLine label="Tables synced" value={String(lastSync.tables)} />
              <StatusLine label="Rows synced" value={String(lastSync.rows)} />
              <StatusLine label="Files synced" value={String(lastSync.files)} />
            </Box>
          ) : (
            <Box paddingLeft={2}>
              <Text dimColor>No sync has been performed yet.</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
