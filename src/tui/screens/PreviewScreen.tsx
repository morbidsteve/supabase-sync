import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { StatusLine } from '../components/StatusLine.js';
import { configExists, loadConfig, type SyncConfig } from '../../core/config.js';
import { getTableCounts, type TableInfo } from '../../db/discovery.js';
import { getSupabaseStorageSummary, type StorageSummary } from '../../storage/supabase.js';
import { getS3StorageSummary } from '../../storage/s3.js';
import { ensurePoolerUrl } from '../../core/supabase-url.js';

interface PreviewScreenProps {
  onBack: () => void;
}

type Direction = 'pull' | 'push';
type Phase = 'no-config' | 'choose-direction' | 'loading' | 'done' | 'error';

interface DirectionItem {
  label: string;
  value: Direction;
}

/**
 * Format bytes into a human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function PreviewScreen({ onBack }: PreviewScreenProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);
  const [storageMessage, setStorageMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Allow any key to return on terminal phases
  useInput((_input, _key) => {
    if (phase === 'done' || phase === 'error' || phase === 'no-config') {
      onBack();
    }
  });

  // Step 1: Load config on mount
  useEffect(() => {
    if (!configExists()) {
      setPhase('no-config');
      return;
    }

    const cfg = loadConfig();

    // Auto-convert Supabase direct URLs to pooler URLs if region is known
    if (cfg.cloud?.region) {
      cfg.cloud.databaseUrl = ensurePoolerUrl(cfg.cloud.databaseUrl, cfg.cloud.region);
    }

    if (!cfg.cloud) {
      setErrorMessage('Cloud credentials are not configured. Run init or settings to configure.');
      setPhase('error');
      return;
    }

    setConfig(cfg);

    // Determine if we need to ask for direction
    if (cfg.cloud && cfg.local) {
      // Both configured -- ask the user
      setPhase('choose-direction');
    } else {
      // Only cloud configured -- default to pull
      setDirection('pull');
      setPhase('loading');
    }
  }, []);

  // Step 2: When direction is set, fetch data from source
  useEffect(() => {
    if (!direction || !config) return;
    let cancelled = false;

    async function fetchData() {
      setPhase('loading');

      const isPull = direction === 'pull';
      const sourceDbUrl = isPull ? config!.cloud!.databaseUrl : config!.local?.databaseUrl;

      if (!sourceDbUrl) {
        const sourceLabel = isPull ? 'Cloud' : 'Local';
        setErrorMessage(`${sourceLabel} database URL is not configured. Run settings to configure.`);
        setPhase('error');
        return;
      }

      // Fetch table counts
      try {
        const fetchedTables = await getTableCounts(
          sourceDbUrl,
          config!.sync.schemas,
          config!.sync.excludeTables,
        );
        if (cancelled) return;
        setTables(fetchedTables);
      } catch (err) {
        if (cancelled) return;
        const sourceLabel = isPull ? 'cloud' : 'local';
        setErrorMessage(`Failed to fetch ${sourceLabel} table counts: ${String(err)}`);
        setPhase('error');
        return;
      }

      // Fetch storage summary
      if (isPull && config!.cloud!.serviceRoleKey) {
        try {
          const summary = await getSupabaseStorageSummary(config!.cloud!);
          if (cancelled) return;
          setStorageSummary(summary);
        } catch (err) {
          if (cancelled) return;
          setStorageMessage(`Failed to fetch cloud storage summary: ${String(err)}`);
        }
      } else if (!isPull && config!.storage?.enabled && config!.storage.localS3) {
        try {
          const summary = await getS3StorageSummary(config!.storage.localS3);
          if (cancelled) return;
          setStorageSummary(summary);
        } catch (err) {
          if (cancelled) return;
          setStorageMessage(`Failed to fetch local storage summary: ${String(err)}`);
        }
      } else {
        if (isPull) {
          setStorageMessage('No service role key configured — cannot preview cloud storage.');
        } else {
          setStorageMessage('Local S3 storage not configured.');
        }
      }

      if (!cancelled) {
        setPhase('done');
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [direction, config]);

  // Handle direction selection
  const handleDirectionSelect = (item: { label: string; value: Direction }) => {
    setDirection(item.value);
  };

  const directionItems: DirectionItem[] = [
    { label: 'Pull  (Cloud \u2192 Local)', value: 'pull' },
    { label: 'Push  (Local \u2192 Cloud)', value: 'push' },
  ];

  // --- Render ---

  // No config
  if (phase === 'no-config') {
    return (
      <Box flexDirection="column">
        <Text color="yellow">No configuration found.</Text>
        <Text dimColor>Run init to set up your project.</Text>
        <Box marginTop={1}>
          <Text dimColor>Press any key to return to menu</Text>
        </Box>
      </Box>
    );
  }

  // Error
  if (phase === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>{errorMessage}</Text>
        <Box marginTop={1}>
          <Text dimColor>Press any key to return to menu</Text>
        </Box>
      </Box>
    );
  }

  // Choose direction
  if (phase === 'choose-direction') {
    return (
      <Box flexDirection="column">
        <Text bold>Which direction would you like to preview?</Text>
        <Box marginTop={1}>
          <SelectInput items={directionItems} onSelect={handleDirectionSelect} />
        </Box>
      </Box>
    );
  }

  // Loading (spinner)
  if (phase === 'loading') {
    const isPull = direction === 'pull';
    const sourceLabel = isPull ? 'cloud' : 'local';
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>Direction: </Text>
          <Text>{isPull ? 'Cloud \u2192 Local' : 'Local \u2192 Cloud'}</Text>
        </Box>
        <Box gap={1}>
          <Text color="yellow"><Spinner type="dots" /></Text>
          <Text color="yellow">Fetching {sourceLabel} table counts...</Text>
        </Box>
      </Box>
    );
  }

  // Done -- show results
  const isPull = direction === 'pull';
  const sourceLabel = isPull ? 'Cloud' : 'Local';
  const transferDirection = isPull ? '\u2192 local' : '\u2192 cloud';
  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);

  return (
    <Box flexDirection="column">
      {/* Direction header */}
      <Box marginBottom={1}>
        <Text bold>Direction: </Text>
        <Text>{isPull ? 'Cloud \u2192 Local' : 'Local \u2192 Cloud'}</Text>
      </Box>

      {/* Sync options */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Sync Options</Text>
        <StatusLine label="Schemas" value={config!.sync.schemas.join(', ')} />
        {config!.sync.excludeTables.length > 0 && (
          <StatusLine label="Excluded tables" value={config!.sync.excludeTables.join(', ')} />
        )}
      </Box>

      {/* Table counts */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{sourceLabel} Database Tables</Text>
        {tables.length === 0 ? (
          <Box paddingLeft={2}>
            <Text dimColor>No tables found to transfer</Text>
          </Box>
        ) : (
          <>
            {tables.map((t) => (
              <StatusLine
                key={`${t.schema}.${t.name}`}
                label={`${t.schema}.${t.name}`}
                value={`~${t.rowCount} rows`}
                pad={30}
              />
            ))}
            <Box paddingLeft={2}>
              <Text dimColor>{'\u2500'.repeat(40)}</Text>
            </Box>
            <StatusLine
              label="Would transfer"
              value={`${tables.length} tables, ~${totalRows} rows ${transferDirection}`}
              pad={30}
            />
          </>
        )}
      </Box>

      {/* Storage summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>{sourceLabel} Storage</Text>
        {storageSummary ? (
          storageSummary.buckets.length === 0 ? (
            <Box paddingLeft={2}>
              <Text dimColor>No storage buckets to transfer</Text>
            </Box>
          ) : (
            <>
              {storageSummary.buckets.map((b) => {
                const sizeStr = b.totalSize > 0 ? ` (${formatBytes(b.totalSize)})` : '';
                return (
                  <StatusLine
                    key={b.name}
                    label={b.name}
                    value={`${b.fileCount} files${sizeStr}`}
                    pad={30}
                  />
                );
              })}
              <Box paddingLeft={2}>
                <Text dimColor>{'\u2500'.repeat(40)}</Text>
              </Box>
              <StatusLine
                label="Would transfer"
                value={`${storageSummary.totalFiles} files${storageSummary.totalSize > 0 ? ` (${formatBytes(storageSummary.totalSize)})` : ''} ${transferDirection}`}
                pad={30}
              />
            </>
          )
        ) : (
          <Box paddingLeft={2}>
            <Text dimColor>{storageMessage}</Text>
          </Box>
        )}
      </Box>

      {/* Dry run notice */}
      <Box marginBottom={1}>
        <Text backgroundColor="yellow" color="black">{' DRY RUN '}</Text>
        <Text color="yellow"> This is a dry run — no changes were made.</Text>
      </Box>

      <Text dimColor>Press any key to return to menu</Text>
    </Box>
  );
}
