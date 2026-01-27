import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig } from '../core/config.js';
import { ensureLocalDb, getLocalDbStatus } from '../docker/local-db.js';
import { testConnection } from '../db/connection.js';
import { getTableCounts, type TableInfo } from '../db/discovery.js';
import { getSupabaseStorageSummary, type StorageSummary } from '../storage/supabase.js';
import { getS3StorageSummary } from '../storage/s3.js';
import { ensurePoolerUrl } from '../core/supabase-url.js';
import { header, success, warn, error, info, sectionTitle, tableRow } from '../ui/format.js';

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

/**
 * Print a table list with row counts.
 */
function printTableSummary(tables: TableInfo[]): void {
  if (tables.length === 0) {
    console.log(info('No tables found'));
    return;
  }

  for (const t of tables) {
    const qualifiedName = `${t.schema}.${t.name}`;
    console.log(tableRow(qualifiedName, `~${t.rowCount} rows`, 30));
  }

  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
  console.log(chalk.dim('  ' + '─'.repeat(38)));
  console.log(tableRow('Total', `${tables.length} tables, ~${totalRows} rows`, 30));
}

/**
 * Print storage summary (Supabase or S3).
 */
function printStorageSummary(summary: StorageSummary): void {
  if (summary.buckets.length === 0) {
    console.log(info('No storage buckets found'));
    return;
  }

  for (const b of summary.buckets) {
    const sizeStr = b.totalSize > 0 ? ` (${formatBytes(b.totalSize)})` : '';
    console.log(tableRow(b.name, `${b.fileCount} files${sizeStr}`, 30));
  }

  const totalSizeStr = summary.totalSize > 0 ? ` (${formatBytes(summary.totalSize)})` : '';
  console.log(chalk.dim('  ' + '─'.repeat(38)));
  console.log(tableRow('Total', `${summary.totalFiles} files${totalSizeStr}`, 30));
}

/**
 * Status command — show connection info, table counts, storage summary, and last sync metadata.
 */
export async function statusCommand(options?: { projectId?: string }): Promise<void> {
  // 1. Check for config
  if (!configExists()) {
    console.log(header('Supabase Sync — Status'));
    console.log('');
    console.log(warn('No configuration found.'));
    console.log(info('Run `supabase-sync init` to set up your project.'));
    console.log('');
    return;
  }

  const config = loadConfig();

  // Auto-convert Supabase direct URLs to pooler URLs if region is known
  if (config.cloud?.region) {
    config.cloud.databaseUrl = ensurePoolerUrl(config.cloud.databaseUrl, config.cloud.region);
  }

  // 2. Header
  const hasCloud = !!config.cloud;
  const initialHasLocal = !!config.local || !!config.docker?.managed;
  const mode = hasCloud && initialHasLocal ? 'Cloud + Local' : hasCloud ? 'Cloud only' : 'Local only';
  console.log(header('Supabase Sync — Status'));
  console.log(info(`Mode: ${mode}`));
  console.log('');

  // 3. Cloud section
  if (hasCloud) {
    console.log(sectionTitle('Cloud Database'));

    const spinner = ora('Testing cloud connection...').start();
    try {
      const conn = await testConnection(config.cloud!.databaseUrl);

      if (conn.connected) {
        spinner.succeed(chalk.green('Cloud database connected'));
        if (conn.version) {
          console.log(info(conn.version));
        }
        console.log('');

        // Table counts
        const tableSpinner = ora('Fetching table counts...').start();
        try {
          const tables = await getTableCounts(
            config.cloud!.databaseUrl,
            config.sync.schemas,
            config.sync.excludeTables,
          );
          tableSpinner.stop();
          printTableSummary(tables);
        } catch (err) {
          tableSpinner.fail(chalk.red('Failed to fetch table counts'));
          console.log(info(String(err)));
        }
      } else {
        spinner.fail(chalk.red('Cloud database connection failed'));
        if (conn.error) {
          console.log(info(conn.error.split('\n')[0]));
        }
      }
    } catch (err) {
      spinner.fail(chalk.red('Cloud database connection failed'));
      console.log(info(String(err)));
    }

    // Cloud storage
    if (config.cloud!.serviceRoleKey) {
      console.log('');
      console.log(sectionTitle('Cloud Storage'));
      const storageSpinner = ora('Fetching storage summary...').start();
      try {
        const summary = await getSupabaseStorageSummary(config.cloud!);
        storageSpinner.stop();
        printStorageSummary(summary);
      } catch (err) {
        storageSpinner.fail(chalk.red('Failed to fetch storage summary'));
        console.log(info(String(err)));
      }
    }

    console.log('');
  } else {
    console.log(sectionTitle('Cloud Database'));
    console.log(info('Not configured'));
    console.log('');
  }

  // 4. Docker Database section
  if (config.docker?.managed) {
    console.log(sectionTitle('Docker Database'));
    const dbStatus = await getLocalDbStatus(config.docker.containerName);
    console.log(tableRow('Container', config.docker.containerName));
    console.log(tableRow('Status', dbStatus.running ? chalk.green('running') : dbStatus.exists ? chalk.yellow('stopped') : chalk.dim('not created')));
    if (dbStatus.port) {
      console.log(tableRow('Port', String(dbStatus.port)));
    }

    // Auto-start if not running
    if (!dbStatus.running) {
      const startSpinner = ora('Starting local database...').start();
      try {
        const url = await ensureLocalDb(config.docker);
        config.local = { databaseUrl: url };
        startSpinner.succeed(chalk.green('Local database started'));
      } catch (err) {
        startSpinner.fail(chalk.red('Failed to start local database'));
        console.log(info(String(err)));
      }
    } else if (!config.local) {
      config.local = { databaseUrl: `postgresql://postgres:postgres@localhost:${dbStatus.port}/postgres` };
    }
    console.log('');
  }

  // 5. Local section
  const hasLocal = !!config.local;
  if (hasLocal) {
    console.log(sectionTitle('Local Database'));

    const spinner = ora('Testing local connection...').start();
    try {
      const conn = await testConnection(config.local!.databaseUrl);

      if (conn.connected) {
        spinner.succeed(chalk.green('Local database connected'));
        if (conn.version) {
          console.log(info(conn.version));
        }
        console.log('');

        // Table counts
        const tableSpinner = ora('Fetching table counts...').start();
        try {
          const tables = await getTableCounts(
            config.local!.databaseUrl,
            config.sync.schemas,
            config.sync.excludeTables,
          );
          tableSpinner.stop();
          printTableSummary(tables);
        } catch (err) {
          tableSpinner.fail(chalk.red('Failed to fetch table counts'));
          console.log(info(String(err)));
        }
      } else {
        spinner.fail(chalk.red('Local database connection failed'));
        if (conn.error) {
          console.log(info(conn.error.split('\n')[0]));
        }
      }
    } catch (err) {
      spinner.fail(chalk.red('Local database connection failed'));
      console.log(info(String(err)));
    }

    // Local S3 storage
    if (config.storage?.enabled && config.storage.localS3) {
      console.log('');
      console.log(sectionTitle('Local Storage (S3)'));
      const storageSpinner = ora('Fetching S3 storage summary...').start();
      try {
        const summary = await getS3StorageSummary(config.storage.localS3);
        storageSpinner.stop();
        printStorageSummary(summary);
      } catch (err) {
        storageSpinner.fail(chalk.red('Failed to fetch S3 storage summary'));
        console.log(info(String(err)));
      }
    }

    console.log('');
  } else {
    console.log(sectionTitle('Local Database'));
    console.log(info('Not configured'));
    console.log('');
  }

  // 5. Last sync section
  if (config.lastSync) {
    console.log(sectionTitle('Last Sync'));
    console.log(tableRow('Direction', config.lastSync.type === 'pull' ? 'Pull (cloud -> local)' : 'Push (local -> cloud)'));
    console.log(tableRow('Timestamp', config.lastSync.timestamp));
    console.log(tableRow('Tables synced', String(config.lastSync.tables)));
    console.log(tableRow('Rows synced', String(config.lastSync.rows)));
    console.log(tableRow('Files synced', String(config.lastSync.files)));
    console.log('');
  } else {
    console.log(sectionTitle('Last Sync'));
    console.log(info('No sync has been performed yet.'));
    console.log('');
  }
}
