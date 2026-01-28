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
import { pullStorage } from '../../storage/sync.js';

interface PullScreenProps {
  onBack: () => void;
}

type SyncPhase = 'checking' | 'previewing' | 'confirming' | 'executing' | 'complete' | 'error' | 'cancelled';

export function PullScreen({ onBack }: PullScreenProps) {
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

      // Auto-convert Supabase direct URLs to pooler URLs
      if (cfg.cloud?.region) {
        cfg.cloud.databaseUrl = ensurePoolerUrl(cfg.cloud.databaseUrl, cfg.cloud.region);
      }

      if (!cfg.cloud) {
        setErrorMessage('Cloud credentials are not configured. Run init or settings to configure.');
        setPhase('error');
        return;
      }

      const steps: TaskStep[] = [];

      // Docker auto-start if managed
      if (cfg.docker?.managed) {
        steps.push({ label: 'Starting local database...', status: 'running' });
        setCheckSteps([...steps]);

        try {
          const url = await ensureLocalDb(cfg.docker);
          if (cancelled) return;
          cfg.local = { databaseUrl: url };
          steps[steps.length - 1] = { label: 'Local database running', status: 'success' };
          setCheckSteps([...steps]);
        } catch (err) {
          if (cancelled) return;
          steps[steps.length - 1] = {
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

      if (!cfg.local) {
        setErrorMessage('Local database is not configured. Run init to set up a Docker-managed database.');
        setPhase('error');
        return;
      }

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

      setConfig(cfg);

      // Move to previewing
      if (!cancelled) {
        setPhase('previewing');
      }
    }

    check();
    return () => { cancelled = true; };
  }, []);

  // Phase: previewing - fetch table counts
  useEffect(() => {
    if (phase !== 'previewing' || !config?.cloud) return;
    let cancelled = false;

    async function preview() {
      try {
        const cloudTables = await getTableCounts(
          config!.cloud!.databaseUrl,
          config!.sync.schemas,
          config!.sync.excludeTables,
        );
        if (cancelled) return;
        setTables(cloudTables);
        setPhase('confirming');
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(`Failed to fetch cloud table counts: ${String(err)}`);
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
        { label: 'Dumping cloud database...', status: 'running' },
        { label: 'Restoring to local database...', status: 'idle' },
      ];

      // Add storage step if applicable
      const hasStorage = !!config!.cloud!.serviceRoleKey;
      if (hasStorage) {
        steps.push({ label: 'Syncing storage files...', status: 'idle' });
      }
      steps.push({ label: 'Verifying...', status: 'idle' });
      setExecSteps([...steps]);

      // Step 1: Dump cloud database
      try {
        await dumpDatabase(config!.cloud!.databaseUrl, {
          schemas: config!.sync.schemas,
          excludeTables: config!.sync.excludeTables,
          dumpFlags: config!.sync.dumpOptions,
        });
        if (cancelled) return;
        steps[0] = {
          label: 'Dumped cloud database',
          status: 'success',
          detail: `${tables.length} tables`,
        };
      } catch (err) {
        if (cancelled) return;
        steps[0] = {
          label: 'Failed to dump cloud database',
          status: 'error',
          detail: String(err),
        };
        setExecSteps([...steps]);
        setErrorMessage('Failed to dump cloud database.');
        setPhase('error');
        return;
      }

      // Step 2: Restore to local
      steps[1] = { label: 'Restoring to local database...', status: 'running' };
      setExecSteps([...steps]);

      try {
        await restoreDatabase(config!.local!.databaseUrl);
        if (cancelled) return;
        const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
        steps[1] = {
          label: 'Restored to local database',
          status: 'success',
          detail: `${tables.length} tables, ~${totalRows} rows`,
        };
      } catch (err) {
        if (cancelled) return;
        steps[1] = {
          label: 'Failed to restore to local database',
          status: 'error',
          detail: String(err),
        };
        setExecSteps([...steps]);
        setErrorMessage('Failed to restore to local database.');
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
          storageFileCount = await pullStorage(
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
            label: 'Storage sync failed (data was still pulled)',
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
        const verifyConn = await testConnection(config!.local!.databaseUrl);
        if (cancelled) return;
        if (verifyConn.connected) {
          verifiedTables = await getTableCounts(
            config!.local!.databaseUrl,
            config!.sync.schemas,
            config!.sync.excludeTables,
          );
          if (cancelled) return;
          steps[verifyStepIndex] = { label: 'Local data verified', status: 'success' };
        } else {
          steps[verifyStepIndex] = { label: 'Could not verify local database', status: 'warning' };
        }
      } catch {
        if (cancelled) return;
        steps[verifyStepIndex] = { label: 'Could not verify local database', status: 'warning' };
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
          type: 'pull',
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
        <Text>Cloud {'\u2192'} Local</Text>
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
          <Text bold>Fetching cloud tables...</Text>
        </Box>
      )}

      {/* Phase: confirming (and later) - show table preview */}
      {tables.length > 0 && phase !== 'checking' && phase !== 'previewing' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Cloud Database Tables</Text>
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

      {/* Phase: confirming */}
      {phase === 'confirming' && (
        <ConfirmPrompt
          message="Pull cloud data to local database?"
          onConfirm={handleConfirm}
        />
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
          <Text color="green" bold>Pull complete!</Text>
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
