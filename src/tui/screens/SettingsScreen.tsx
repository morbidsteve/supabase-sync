import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { StepList } from '../components/StepList.js';
import { StatusLine } from '../components/StatusLine.js';
import { ConfirmPrompt } from '../components/ConfirmPrompt.js';
import type { TaskStep } from '../types.js';
import { configExists, loadConfig, saveConfig, type SyncConfig } from '../../core/config.js';
import { testConnection } from '../../db/connection.js';
import { ensureLocalDb, stopLocalDb, removeLocalDb, getLocalDbStatus } from '../../docker/local-db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsScreenProps {
  onBack: () => void;
}

type SubView =
  | 'menu'
  | 'update_cloud'
  | 'update_local'
  | 'sync_options'
  | 'test_connections'
  | 'manage_docker'
  | 'clear_cloud';

type SettingsMenuValue =
  | 'update_cloud'
  | 'update_local'
  | 'sync_options'
  | 'test_connections'
  | 'manage_docker'
  | 'clear_cloud'
  | 'back';

type DockerAction = 'start' | 'stop' | 'remove' | 'back';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskValue(value: string): string {
  if (value.length <= 16) {
    if (value.length <= 8) return '****';
    return value.slice(0, 4) + '...' + value.slice(-4);
  }
  return value.slice(0, 12) + '...' + value.slice(-6);
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

// ---------------------------------------------------------------------------
// Sub-view: Config Summary
// ---------------------------------------------------------------------------

function ConfigSummary({ config }: { config: SyncConfig }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Current Configuration</Text>

      {/* Cloud */}
      {config.cloud ? (
        <Box flexDirection="column">
          <StatusLine label="Cloud project" value={maskValue(config.cloud.projectUrl)} />
          <StatusLine label="Cloud DB" value={maskValue(config.cloud.databaseUrl)} />
          <StatusLine label="Anon key" value={maskSecret(config.cloud.anonKey)} />
          <StatusLine
            label="Service role key"
            value={config.cloud.serviceRoleKey ? maskSecret(config.cloud.serviceRoleKey) : 'not set'}
          />
        </Box>
      ) : (
        <StatusLine label="Cloud" value="not configured" />
      )}

      {/* Local / Docker */}
      {config.docker?.managed ? (
        <StatusLine
          label="Local DB"
          value={`Docker (${config.docker.containerName}, port ${config.docker.port})`}
        />
      ) : config.local ? (
        <StatusLine label="Local DB" value={config.local.databaseUrl} />
      ) : (
        <StatusLine label="Local DB" value="not configured" />
      )}

      {/* Sync options */}
      <StatusLine label="Schemas" value={config.sync.schemas.join(', ')} />
      <StatusLine
        label="Excluded tables"
        value={config.sync.excludeTables.length > 0 ? config.sync.excludeTables.join(', ') : 'none'}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: Update Cloud Credentials
// ---------------------------------------------------------------------------

function UpdateCloudView({
  config,
  onDone,
}: {
  config: SyncConfig;
  onDone: () => void;
}) {
  const [field, setField] = useState(0); // 0=projectUrl, 1=databaseUrl, 2=anonKey, 3=serviceRoleKey
  const [projectUrl, setProjectUrl] = useState(config.cloud?.projectUrl ?? '');
  const [databaseUrl, setDatabaseUrl] = useState(config.cloud?.databaseUrl ?? '');
  const [anonKey, setAnonKey] = useState(config.cloud?.anonKey ?? '');
  const [serviceRoleKey, setServiceRoleKey] = useState(config.cloud?.serviceRoleKey ?? '');

  // Handle escape to go back without saving
  useInput((_input, key) => {
    if (key.escape) {
      onDone();
    }
  });

  const handleSubmit = useCallback(
    (fieldIndex: number) => {
      if (fieldIndex < 3) {
        setField(fieldIndex + 1);
      } else {
        // Save on final field submit
        config.cloud = {
          projectUrl,
          databaseUrl,
          anonKey,
          ...(serviceRoleKey
            ? { serviceRoleKey }
            : config.cloud?.serviceRoleKey
              ? { serviceRoleKey: config.cloud.serviceRoleKey }
              : {}),
        };
        saveConfig(config);
        onDone();
      }
    },
    [projectUrl, databaseUrl, anonKey, serviceRoleKey, config, onDone],
  );

  const fields = [
    { label: 'Project URL', value: projectUrl, onChange: setProjectUrl },
    { label: 'Database URL', value: databaseUrl, onChange: setDatabaseUrl },
    { label: 'Anon Key', value: anonKey, onChange: setAnonKey },
    { label: 'Service Role Key', value: serviceRoleKey, onChange: setServiceRoleKey },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Update Cloud Credentials</Text>
      <Text dimColor>Press Enter to advance, Escape to cancel</Text>
      <Box flexDirection="column" marginTop={1}>
        {fields.map((f, i) => (
          <Box key={f.label} gap={1}>
            <Text>{f.label + ':'}</Text>
            {i === field ? (
              <TextInput
                value={f.value}
                onChange={f.onChange}
                onSubmit={() => handleSubmit(i)}
              />
            ) : (
              <Text dimColor>{f.value || '(empty)'}</Text>
            )}
            {i === field && <Text color="cyan">{' <'}</Text>}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: Update Local Database URL
// ---------------------------------------------------------------------------

function UpdateLocalView({
  config,
  onDone,
}: {
  config: SyncConfig;
  onDone: () => void;
}) {
  const defaultUrl = config.local?.databaseUrl ?? 'postgresql://postgres:postgres@localhost:54322/postgres';
  const [url, setUrl] = useState(defaultUrl);

  useInput((_input, key) => {
    if (key.escape) {
      onDone();
    }
  });

  const handleSubmit = useCallback(() => {
    config.local = { databaseUrl: url };
    saveConfig(config);
    onDone();
  }, [url, config, onDone]);

  return (
    <Box flexDirection="column">
      <Text bold>Update Local Database URL</Text>
      <Text dimColor>Press Enter to save, Escape to cancel</Text>
      <Box marginTop={1} gap={1}>
        <Text>Database URL:</Text>
        <TextInput value={url} onChange={setUrl} onSubmit={handleSubmit} />
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: Sync Options
// ---------------------------------------------------------------------------

function SyncOptionsView({
  config,
  onDone,
}: {
  config: SyncConfig;
  onDone: () => void;
}) {
  const [field, setField] = useState(0); // 0=schemas, 1=excludeTables
  const [schemas, setSchemas] = useState(config.sync.schemas.join(', '));
  const [excludeTables, setExcludeTables] = useState(config.sync.excludeTables.join(', '));

  useInput((_input, key) => {
    if (key.escape) {
      onDone();
    }
  });

  const handleSubmit = useCallback(
    (fieldIndex: number) => {
      if (fieldIndex === 0) {
        setField(1);
      } else {
        config.sync.schemas = schemas
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        config.sync.excludeTables = excludeTables
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        saveConfig(config);
        onDone();
      }
    },
    [schemas, excludeTables, config, onDone],
  );

  const fields = [
    { label: 'Schemas (comma-separated)', value: schemas, onChange: setSchemas },
    { label: 'Excluded tables (comma-separated)', value: excludeTables, onChange: setExcludeTables },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Sync Options</Text>
      <Text dimColor>Press Enter to advance, Escape to cancel</Text>
      <Box flexDirection="column" marginTop={1}>
        {fields.map((f, i) => (
          <Box key={f.label} gap={1}>
            <Text>{f.label + ':'}</Text>
            {i === field ? (
              <TextInput
                value={f.value}
                onChange={f.onChange}
                onSubmit={() => handleSubmit(i)}
              />
            ) : (
              <Text dimColor>{f.value || '(empty)'}</Text>
            )}
            {i === field && <Text color="cyan">{' <'}</Text>}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: Test Connections
// ---------------------------------------------------------------------------

function TestConnectionsView({
  config,
  onDone,
}: {
  config: SyncConfig;
  onDone: () => void;
}) {
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [done, setDone] = useState(false);

  useInput(() => {
    if (done) {
      onDone();
    }
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const results: TaskStep[] = [];

      // Cloud
      if (config.cloud) {
        results.push({ label: 'Testing cloud connection...', status: 'running' });
        setSteps([...results]);

        try {
          const conn = await testConnection(config.cloud.databaseUrl);
          if (cancelled) return;
          if (conn.connected) {
            results[results.length - 1] = {
              label: 'Cloud database connected',
              status: 'success',
              detail: conn.version,
            };
          } else {
            results[results.length - 1] = {
              label: 'Cloud database connection failed',
              status: 'error',
              detail: conn.error?.split('\n')[0],
            };
          }
        } catch (err) {
          if (cancelled) return;
          results[results.length - 1] = {
            label: 'Cloud database connection failed',
            status: 'error',
            detail: String(err),
          };
        }
        setSteps([...results]);
      } else {
        results.push({ label: 'Cloud database: not configured', status: 'warning' });
        setSteps([...results]);
      }

      // Local
      if (config.local) {
        results.push({ label: 'Testing local connection...', status: 'running' });
        setSteps([...results]);

        try {
          const conn = await testConnection(config.local.databaseUrl);
          if (cancelled) return;
          if (conn.connected) {
            results[results.length - 1] = {
              label: 'Local database connected',
              status: 'success',
              detail: conn.version,
            };
          } else {
            results[results.length - 1] = {
              label: 'Local database connection failed',
              status: 'error',
              detail: conn.error?.split('\n')[0],
            };
          }
        } catch (err) {
          if (cancelled) return;
          results[results.length - 1] = {
            label: 'Local database connection failed',
            status: 'error',
            detail: String(err),
          };
        }
        setSteps([...results]);
      } else {
        results.push({ label: 'Local database: not configured', status: 'warning' });
        setSteps([...results]);
      }

      if (!config.cloud && !config.local) {
        results.push({ label: 'No credentials configured', status: 'warning' });
        setSteps([...results]);
      }

      if (!cancelled) {
        setDone(true);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return (
    <Box flexDirection="column">
      <Text bold>Test Connections</Text>
      <Box marginTop={1}>
        <StepList steps={steps} />
      </Box>
      {done && (
        <Box marginTop={1}>
          <Text dimColor>Press any key to return to settings</Text>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: Manage Docker Database
// ---------------------------------------------------------------------------

function ManageDockerView({
  config,
  onDone,
}: {
  config: SyncConfig;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'loading' | 'menu' | 'executing' | 'done'>('loading');
  const [containerStatus, setContainerStatus] = useState<{
    exists: boolean;
    running: boolean;
    port: number | null;
  }>({ exists: false, running: false, port: null });
  const [steps, setSteps] = useState<TaskStep[]>([]);
  const [resultMessage, setResultMessage] = useState('');

  useInput((_input, key) => {
    if (phase === 'done') {
      onDone();
      return;
    }
    if (key.escape && phase === 'menu') {
      onDone();
    }
  });

  // Load status on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!config.docker?.managed) {
        setResultMessage('No Docker-managed database configured.');
        setPhase('done');
        return;
      }

      try {
        const status = await getLocalDbStatus(config.docker.containerName);
        if (cancelled) return;
        setContainerStatus(status);
        setPhase('menu');
      } catch {
        if (cancelled) return;
        setResultMessage('Failed to check Docker status.');
        setPhase('done');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [config]);

  const handleDockerAction = useCallback(
    (item: { value: DockerAction }) => {
      if (item.value === 'back') {
        onDone();
        return;
      }

      setPhase('executing');

      const action = item.value;

      (async () => {
        const s: TaskStep[] = [];

        if (action === 'start') {
          s.push({ label: 'Starting local database...', status: 'running' });
          setSteps([...s]);
          try {
            const url = await ensureLocalDb(config.docker!);
            config.local = { databaseUrl: url };
            saveConfig(config);
            s[0] = {
              label: `Local database running on port ${config.docker!.port}`,
              status: 'success',
            };
          } catch (err) {
            s[0] = {
              label: 'Failed to start local database',
              status: 'error',
              detail: String(err),
            };
          }
        } else if (action === 'stop') {
          s.push({ label: 'Stopping local database...', status: 'running' });
          setSteps([...s]);
          try {
            await stopLocalDb(config.docker!.containerName);
            s[0] = { label: 'Local database stopped', status: 'success' };
          } catch (err) {
            s[0] = {
              label: 'Failed to stop local database',
              status: 'error',
              detail: String(err),
            };
          }
        } else if (action === 'remove') {
          s.push({ label: 'Removing local database...', status: 'running' });
          setSteps([...s]);
          try {
            await removeLocalDb(config.docker!.containerName, config.docker!.volumeName);
            delete config.docker;
            delete config.local;
            saveConfig(config);
            s[0] = { label: 'Docker database removed', status: 'success' };
          } catch (err) {
            s[0] = {
              label: 'Failed to remove local database',
              status: 'error',
              detail: String(err),
            };
          }
        }

        setSteps([...s]);
        setPhase('done');
      })();
    },
    [config, onDone],
  );

  if (phase === 'loading') {
    return (
      <Box flexDirection="column">
        <Text bold>Manage Docker Database</Text>
        <Text dimColor>Checking container status...</Text>
      </Box>
    );
  }

  const dockerMenuItems: { label: string; value: DockerAction }[] = [
    {
      label: containerStatus.running ? 'Restart container' : 'Start container',
      value: 'start',
    },
    { label: 'Stop container', value: 'stop' },
    { label: 'Remove container and data', value: 'remove' },
    { label: 'Back', value: 'back' },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Manage Docker Database</Text>

      {config.docker?.managed && (
        <Box flexDirection="column" marginBottom={1}>
          <StatusLine label="Container" value={config.docker.containerName} />
          <StatusLine label="Volume" value={config.docker.volumeName} />
          <StatusLine label="Port" value={String(config.docker.port)} />
          <StatusLine
            label="Status"
            value={
              containerStatus.running
                ? 'running'
                : containerStatus.exists
                  ? 'stopped'
                  : 'not created'
            }
          />
        </Box>
      )}

      {phase === 'menu' && (
        <SelectInput items={dockerMenuItems} onSelect={handleDockerAction} />
      )}

      {(phase === 'executing' || phase === 'done') && steps.length > 0 && (
        <Box marginTop={1}>
          <StepList steps={steps} />
        </Box>
      )}

      {phase === 'done' && resultMessage && (
        <Box marginTop={1}>
          <Text dimColor>{resultMessage}</Text>
        </Box>
      )}

      {phase === 'done' && (
        <Box marginTop={1}>
          <Text dimColor>Press any key to return to settings</Text>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-view: Clear Cloud Credentials
// ---------------------------------------------------------------------------

function ClearCloudView({
  config,
  onDone,
}: {
  config: SyncConfig;
  onDone: () => void;
}) {
  const [cleared, setCleared] = useState(false);

  if (!config.cloud) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Cloud credentials are not configured - nothing to clear.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press any key to return to settings</Text>
        </Box>
      </Box>
    );
  }

  if (cleared) {
    return (
      <Box flexDirection="column">
        <Text color="green">Cloud credentials removed.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press any key to return to settings</Text>
        </Box>
      </Box>
    );
  }

  return (
    <ConfirmPrompt
      message="Remove cloud credentials from configuration?"
      destructive
      onConfirm={(yes) => {
        if (yes) {
          delete config.cloud;
          saveConfig(config);
          setCleared(true);
        } else {
          onDone();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main SettingsScreen
// ---------------------------------------------------------------------------

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const [subView, setSubView] = useState<SubView>('menu');
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [hasConfig, setHasConfig] = useState(true);

  // Load config on mount and when returning to menu
  useEffect(() => {
    if (subView === 'menu') {
      if (!configExists()) {
        setHasConfig(false);
        return;
      }
      setHasConfig(true);
      setConfig(loadConfig());
    }
  }, [subView]);

  // Handle escape when on the main menu
  useInput((_input, key) => {
    if (subView === 'menu' && key.escape) {
      onBack();
    }
  });

  // Handle the ClearCloudView "press any key" after clearing
  // It is handled inside the ClearCloudView component via the ConfirmPrompt

  const returnToMenu = useCallback(() => {
    setSubView('menu');
  }, []);

  // No config
  if (!hasConfig) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No configuration found.</Text>
        <Text dimColor>Run init to set up your project first.</Text>
      </Box>
    );
  }

  // Loading
  if (!config) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Loading configuration...</Text>
      </Box>
    );
  }

  // Sub-views
  if (subView === 'update_cloud') {
    return <UpdateCloudView config={config} onDone={returnToMenu} />;
  }

  if (subView === 'update_local') {
    return <UpdateLocalView config={config} onDone={returnToMenu} />;
  }

  if (subView === 'sync_options') {
    return <SyncOptionsView config={config} onDone={returnToMenu} />;
  }

  if (subView === 'test_connections') {
    return <TestConnectionsView config={config} onDone={returnToMenu} />;
  }

  if (subView === 'manage_docker') {
    return <ManageDockerView config={config} onDone={returnToMenu} />;
  }

  if (subView === 'clear_cloud') {
    return <ClearCloudView config={config} onDone={returnToMenu} />;
  }

  // Main settings menu
  const menuItems: { label: string; value: SettingsMenuValue }[] = [
    { label: 'Update Cloud Credentials', value: 'update_cloud' },
    { label: 'Update Local Database URL', value: 'update_local' },
    { label: 'Sync Options', value: 'sync_options' },
    { label: 'Test Connections', value: 'test_connections' },
  ];

  if (config.docker?.managed) {
    menuItems.push({ label: 'Manage Docker Database', value: 'manage_docker' });
  }

  menuItems.push({ label: 'Clear Cloud Credentials', value: 'clear_cloud' });
  menuItems.push({ label: 'Back', value: 'back' });

  const handleMenuSelect = (item: { label: string; value: SettingsMenuValue }) => {
    if (item.value === 'back') {
      onBack();
      return;
    }
    setSubView(item.value);
  };

  return (
    <Box flexDirection="column">
      <ConfigSummary config={config} />

      <Box flexDirection="column">
        <Text bold>What would you like to configure?</Text>
        <Box marginTop={1}>
          <SelectInput items={menuItems} onSelect={handleMenuSelect} />
        </Box>
      </Box>
    </Box>
  );
}
