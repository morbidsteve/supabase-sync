import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { StepList } from '../components/StepList.js';
import { StatusLine } from '../components/StatusLine.js';
import { ConfirmPrompt } from '../components/ConfirmPrompt.js';
import type { TaskStep } from '../types.js';
import { configExists, loadConfig, saveConfig, type SyncConfig } from '../../core/config.js';
import { testConnection } from '../../db/connection.js';
import { getTableCounts, type TableInfo } from '../../db/discovery.js';
import { dumpDatabase } from '../../db/dump.js';
import { restoreDatabase } from '../../db/restore.js';
import { ensureLocalDb } from '../../docker/local-db.js';
import { ensurePoolerUrl } from '../../core/supabase-url.js';
import { pushStorage } from '../../storage/sync.js';

interface PushScreenProps {
  onBack: () => void;
}

type SyncPhase = 'checking' | 'previewing' | 'confirming' | 'executing' | 'complete' | 'error' | 'cancelled';

export function PushScreen({ onBack }: PushScreenProps) {
  const [phase, setPhase] = useState<SyncPhase>('checking');
  const [errorMessage, setErrorMessage] = useState('');

  // Connection check steps
  const [checkSteps, setCheckSteps] = useState<TaskStep[]>([]);

  // Preview data
  const [tables, setTables] = useState<TableInfo[]>([]);

  // Execution steps
  const [execSteps, setExecSteps] = useState<TaskStep[]>([]);

  // Summary data
  const [summary, setSummary] = useState({ tables: 0, rows: 0, files: 0 });

  // Config ref for use across phases
  const [config, setConfig] = useState<SyncConfig | null>(null);

  // Allow any key to return on terminal phases
  useInput((_input, _key) => {
    if (phase === 'complete' || phase === 'error' || phase === 'cancelled') {
      onBack();
    }
  });

  // Phase: checking - test connections on mount
  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!configExists()) {
        setErrorMessage('No configuration found. Run init to set up your project.');
        setPhase('error');
        return;
      }

      const cfg = loadConfig();

      // Docker auto-start if managed
      if (cfg.docker?.managed) {
        const steps: TaskStep[] = [{ label: 'Starting local database...', status: 'running' }];
        setCheckSteps([...steps]);

        try {
          const url = await ensureLocalDb(cfg.docker);
          if (cancelled) return;
          cfg.local = { databaseUrl: url };
          steps[0] = { label: 'Local database running', status: 'success' };
          setCheckSteps([...steps]);
        } catch (err) {
          if (cancelled) return;
          steps[0] = {
            label: 'Failed to start local database',
            status: 'error',
            detail: String(err),
          };
          setCheckSteps([...steps]);
          setErrorMessage('Failed to start local database.');
          setPhase('error');
          return;
        }
      }

      // Auto-convert Supabase direct URLs to pooler URLs
      if (cfg.cloud?.region) {
        cfg.cloud.databaseUrl = ensurePoolerUrl(cfg.cloud.databaseUrl, cfg.cloud.region);
      }

      if (!cfg.local) {
        setErrorMessage('Local database is not configured. Run init to set up a Docker-managed database.');
        setPhase('error');
        return;
      }

      if (!cfg.cloud) {
        setErrorMessage('Cloud credentials are not configured. Run init or settings to configure.');
        setPhase('error');
        return;
      }

      const steps = [...(checkSteps.length > 0 ? checkSteps : [] as TaskStep[])];

      // Test local connection
      steps.push({ label: 'Testing local connection...', status: 'running' });
      setCheckSteps([...steps]);

      const localConn = await testConnection(cfg.local.databaseUrl);
      if (cancelled) return;

      if (!localConn.connected) {
        steps[steps.length - 1] = {
          label: 'Local database connection failed',
          status: 'error',
          detail: localConn.error?.split('\n')[0],
        };
        setCheckSteps([...steps]);
        setErrorMessage('Local database connection failed.');
        setPhase('error');
        return;
      }

      steps[steps.length - 1] = {
        label: 'Local database connected',
        status: 'success',
        detail: localConn.version,
      };
      setCheckSteps([...steps]);

      // Test cloud connection
      steps.push({ label: 'Testing cloud connection...', status: 'running' });
      setCheckSteps([...steps]);

      const cloudConn = await testConnection(cfg.cloud.databaseUrl);
      if (cancelled) return;

      if (!cloudConn.connected) {
        steps[steps.length - 1] = {
          label: 'Cloud database connection failed',
          status: 'error',
          detail: cloudConn.error?.split('\n')[0],
        };
        setCheckSteps([...steps]);
        setErrorMessage('Cloud database connection failed.');
        setPhase('error');
        return;
      }

      steps[steps.length - 1] = {
        label: 'Cloud database connected',
        status: 'success',
        detail: cloudConn.version,
      };
      setCheckSteps([...steps]);

      setConfig(cfg);

      // Move to previewing
      if (!cancelled) {
        setPhase('previewing');
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  // Phase: previewing - fetch table counts from local (source)
  useEffect(() => {
    if (phase !== 'previewing' || !config?.local) return;
    let cancelled = false;

    async function preview() {
      try {
        const localTables = await getTableCounts(
          config!.local!.databaseUrl,
          config!.sync.schemas,
          config!.sync.excludeTables,
        );
        if (cancelled) return;
        setTables(localTables);
        setPhase('confirming');
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(`Failed to fetch local table counts: ${String(err)}`);
        setPhase('error');
      }
    }

    preview();
    return () => { cancelled = true; };
  }, [phase, config]);

  // Handle confirm response
  function handleConfirm(yes: boolean) {
    if (yes) {
      setPhase('executing');
    } else {
      setPhase('cancelled');
    }
  }

  // Phase: executing - dump, restore, storage sync
  useEffect(() => {
    if (phase !== 'executing' || !config?.cloud || !config?.local) return;
    let cancelled = false;

    async function execute() {
      const steps: TaskStep[] = [
        { label: 'Dumping local database...', status: 'running' },
        { label: 'Restoring to cloud database...', status: 'idle' },
      ];

      // Add storage step if applicable
      const hasStorage = !!config!.cloud!.serviceRoleKey && !!config!.storage?.localS3;
      if (hasStorage) {
        steps.push({ label: 'Syncing storage files...', status: 'idle' });
      }
      steps.push({ label: 'Verifying...', status: 'idle' });
      setExecSteps([...steps]);

      // Step 1: Dump local database
      try {
        await dumpDatabase(config!.local!.databaseUrl, {
          schemas: config!.sync.schemas,
          excludeTables: config!.sync.excludeTables,
          dumpFlags: config!.sync.dumpOptions,
        });
        if (cancelled) return;
        steps[0] = {
          label: 'Dumped local database',
          status: 'success',
          detail: `${tables.length} tables`,
        };
      } catch (err) {
        if (cancelled) return;
        steps[0] = {
          label: 'Failed to dump local database',
          status: 'error',
          detail: String(err),
        };
        setExecSteps([...steps]);
        setErrorMessage('Failed to dump local database.');
        setPhase('error');
        return;
      }

      // Step 2: Restore to cloud
      steps[1] = { label: 'Restoring to cloud database...', status: 'running' };
      setExecSteps([...steps]);

      try {
        await restoreDatabase(config!.cloud!.databaseUrl);
        if (cancelled) return;
        const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
        steps[1] = {
          label: 'Restored to cloud database',
          status: 'success',
          detail: `${tables.length} tables, ~${totalRows} rows`,
        };
      } catch (err) {
        if (cancelled) return;
        steps[1] = {
          label: 'Failed to restore to cloud database',
          status: 'error',
          detail: String(err),
        };
        setExecSteps([...steps]);
        setErrorMessage('Failed to restore to cloud database.');
        setPhase('error');
        return;
      }

      // Step 3: Storage sync (non-fatal)
      let storageFileCount = 0;
      const storageStepIndex = hasStorage ? 2 : -1;
      const verifyStepIndex = hasStorage ? 3 : 2;

      if (hasStorage) {
        steps[storageStepIndex] = { label: 'Syncing storage files...', status: 'running' };
        setExecSteps([...steps]);

        try {
          storageFileCount = await pushStorage(
            config!.cloud!,
            config!.storage?.localS3,
          );
          if (cancelled) return;
          steps[storageStepIndex] = {
            label: 'Storage synced',
            status: 'success',
            detail: `${storageFileCount} files`,
          };
        } catch (err) {
          if (cancelled) return;
          steps[storageStepIndex] = {
            label: 'Storage sync failed (database was still pushed)',
            status: 'warning',
            detail: String(err),
          };
        }
        setExecSteps([...steps]);
      }

      // Step 4: Verify
      steps[verifyStepIndex] = { label: 'Verifying...', status: 'running' };
      setExecSteps([...steps]);

      let verifiedTables: TableInfo[] = [];
      try {
        const verifyConn = await testConnection(config!.cloud!.databaseUrl);
        if (cancelled) return;
        if (verifyConn.connected) {
          verifiedTables = await getTableCounts(
            config!.cloud!.databaseUrl,
            config!.sync.schemas,
            config!.sync.excludeTables,
          );
          if (cancelled) return;
          steps[verifyStepIndex] = { label: 'Cloud data verified', status: 'success' };
        } else {
          steps[verifyStepIndex] = { label: 'Could not verify cloud database', status: 'warning' };
        }
      } catch {
        if (cancelled) return;
        steps[verifyStepIndex] = { label: 'Could not verify cloud database', status: 'warning' };
      }
      setExecSteps([...steps]);

      // Save lastSync metadata
      const tableCount = verifiedTables.length > 0 ? verifiedTables.length : tables.length;
      const totalRows = verifiedTables.length > 0
        ? verifiedTables.reduce((sum, t) => sum + t.rowCount, 0)
        : tables.reduce((sum, t) => sum + t.rowCount, 0);

      const updatedConfig: SyncConfig = {
        ...config!,
        lastSync: {
          type: 'push',
          timestamp: new Date().toISOString(),
          tables: tableCount,
          rows: totalRows,
          files: storageFileCount,
        },
      };
      saveConfig(updatedConfig);

      setSummary({ tables: tableCount, rows: totalRows, files: storageFileCount });

      if (!cancelled) {
        setPhase('complete');
      }
    }

    execute();
    return () => { cancelled = true; };
  }, [phase, config, tables]);

  // --- Render ---

  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);

  return (
    <Box flexDirection="column">
      {/* Direction header */}
      <Box marginBottom={1}>
        <Text bold>Direction: </Text>
        <Text>Local {'\u2192'} Cloud</Text>
      </Box>

      {/* Phase: checking */}
      {(phase === 'checking' || checkSteps.length > 0) && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Connection Check</Text>
          <StepList steps={checkSteps} />
        </Box>
      )}

      {/* Phase: previewing */}
      {phase === 'previewing' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Fetching local tables...</Text>
        </Box>
      )}

      {/* Phase: confirming (and later) - show table preview */}
      {tables.length > 0 && phase !== 'checking' && phase !== 'previewing' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Local Database Tables</Text>
          {tables.map((t) => (
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
            value={`${tables.length} tables, ~${totalRows} rows`}
            pad={30}
          />
        </Box>
      )}

      {/* Phase: confirming - destructive warning + confirm */}
      {phase === 'confirming' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="red">
              WARNING: This will overwrite cloud data with local data. This operation cannot be undone.
            </Text>
          </Box>
          <ConfirmPrompt
            message="Push local data to cloud database? This will overwrite cloud data."
            destructive={true}
            onConfirm={handleConfirm}
          />
        </Box>
      )}

      {/* Phase: executing */}
      {(phase === 'executing' || phase === 'complete') && execSteps.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Syncing</Text>
          <StepList steps={execSteps} />
        </Box>
      )}

      {/* Phase: complete */}
      {phase === 'complete' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>Push complete!</Text>
          <StatusLine label="Tables" value={String(summary.tables)} />
          <StatusLine label="Rows" value={`~${summary.rows}`} />
          {summary.files > 0 && (
            <StatusLine label="Files" value={String(summary.files)} />
          )}
          <Box marginTop={1}>
            <Text dimColor>Press any key to return to menu</Text>
          </Box>
        </Box>
      )}

      {/* Phase: error */}
      {phase === 'error' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="red" bold>{errorMessage}</Text>
          <Box marginTop={1}>
            <Text dimColor>Press any key to return to menu</Text>
          </Box>
        </Box>
      )}

      {/* Phase: cancelled */}
      {phase === 'cancelled' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>Cancelled.</Text>
          <Box marginTop={1}>
            <Text dimColor>Press any key to return to menu</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
