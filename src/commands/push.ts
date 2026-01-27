import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig, saveConfig, type SyncConfig } from '../core/config.js';
import { ensureLocalDb } from '../docker/local-db.js';
import { testConnection, isPooledUrl } from '../db/connection.js';
import { getTableCounts, type TableInfo } from '../db/discovery.js';
import { dumpDatabase } from '../db/dump.js';
import { restoreDatabase } from '../db/restore.js';
import { getS3StorageSummary } from '../storage/s3.js';
import { pushStorage } from '../storage/sync.js';
import { header, success, warn, error, info, sectionTitle, tableRow } from '../ui/format.js';
import { confirmDestructive } from '../ui/prompts.js';

/**
 * Mask a database URL for display, showing only the start and end.
 */
function maskUrl(url: string): string {
  if (url.length <= 30) return url;
  return url.slice(0, 20) + '...' + url.slice(-10);
}

/**
 * Push command — dump local database and restore to cloud,
 * then sync storage files.
 */
export async function pushCommand(options?: { yes?: boolean }): Promise<void> {
  // 1. Config check
  if (!configExists()) {
    console.log(header('Supabase Sync — Push'));
    console.log('');
    console.log(error('No configuration found.'));
    console.log(info('Run `supabase-sync init` to set up your project.'));
    console.log('');
    return;
  }

  const config = loadConfig();

  // 2. Auto-start Docker-managed local DB if configured
  if (config.docker?.managed) {
    const dbSpinner = ora('Starting local database...').start();
    try {
      const url = await ensureLocalDb(config.docker);
      config.local = { databaseUrl: url };
      dbSpinner.succeed(chalk.green('Local database running'));
    } catch (err) {
      dbSpinner.fail(chalk.red('Failed to start local database'));
      console.log(info(String(err)));
      console.log('');
      return;
    }
  }

  // 3. Local DB check — need local credentials for push source
  if (!config.local) {
    console.log(header('Supabase Sync — Push'));
    console.log('');
    console.log(error('Local database is not configured.'));
    console.log(info('A local database is required as the push source.'));
    console.log(info('Run `supabase-sync init` to set up a Docker-managed database,'));
    console.log(info('or `supabase-sync settings` to configure an existing database.'));
    console.log('');
    return;
  }

  // 3. Cloud credential check — need cloud credentials for push target
  if (!config.cloud) {
    console.log(header('Supabase Sync — Push'));
    console.log('');
    console.log(warn('Fresh Project Detection'));
    console.log('');
    console.log(error('No cloud credentials found.'));
    console.log(info('Cloud credentials are required as the push target.'));
    console.log(info('Run `supabase-sync init` or `supabase-sync settings` to configure cloud credentials.'));
    console.log('');
    return;
  }

  console.log(header('Supabase Sync — Push (local -> cloud)'));
  console.log('');

  // 4. Test connections
  const localSpinner = ora('Testing local connection...').start();
  const localConn = await testConnection(config.local.databaseUrl);
  if (!localConn.connected) {
    localSpinner.fail(chalk.red('Local database connection failed'));
    if (localConn.error) {
      console.log(info(localConn.error.split('\n')[0]));
    }
    console.log(info('Make sure your local PostgreSQL server is running.'));
    console.log('');
    return;
  }
  localSpinner.succeed(chalk.green('Local database connected'));
  if (localConn.version) {
    console.log(info(localConn.version));
  }

  const cloudSpinner = ora('Testing cloud connection...').start();
  const cloudConn = await testConnection(config.cloud.databaseUrl);
  if (!cloudConn.connected) {
    cloudSpinner.fail(chalk.red('Cloud database connection failed'));
    if (cloudConn.error) {
      console.log(info(cloudConn.error.split('\n')[0]));
    }
    console.log('');
    return;
  }
  cloudSpinner.succeed(chalk.green('Cloud database connected'));
  if (cloudConn.version) {
    console.log(info(cloudConn.version));
  }

  // Warn if cloud URL is pooled (pg_dump/psql restore won't work through PgBouncer)
  if (isPooledUrl(config.cloud.databaseUrl)) {
    console.log('');
    console.log(warn('Cloud URL appears to use connection pooling (port 6543).'));
    console.log(info('Restoring through PgBouncer may fail. Use the direct connection URL instead.'));
  }

  console.log('');

  // 5. Preview — show what will be pushed
  console.log(sectionTitle('Local Database Tables'));
  const tableSpinner = ora('Fetching local table counts...').start();

  let localTables: TableInfo[] = [];
  try {
    localTables = await getTableCounts(
      config.local.databaseUrl,
      config.sync.schemas,
      config.sync.excludeTables,
    );
    tableSpinner.stop();

    if (localTables.length === 0) {
      console.log(info('No tables found in local database'));
    } else {
      for (const t of localTables) {
        const qualifiedName = `${t.schema}.${t.name}`;
        console.log(tableRow(qualifiedName, `~${t.rowCount} rows`, 30));
      }
      const totalRows = localTables.reduce((sum, t) => sum + t.rowCount, 0);
      console.log(chalk.dim('  ' + '─'.repeat(38)));
      console.log(tableRow('Total', `${localTables.length} tables, ~${totalRows} rows`, 30));
    }
  } catch (err) {
    tableSpinner.fail(chalk.red('Failed to fetch local table counts'));
    console.log(info(String(err)));
    console.log('');
    return;
  }

  console.log('');

  // Storage preview (local S3)
  let hasStorage = false;
  if (config.storage?.localS3) {
    console.log(sectionTitle('Local Storage'));
    const storageSpinner = ora('Fetching local storage summary...').start();
    try {
      const summary = await getS3StorageSummary(config.storage.localS3);
      storageSpinner.stop();
      if (summary.buckets.length === 0) {
        console.log(info('No storage buckets found'));
      } else {
        for (const b of summary.buckets) {
          console.log(tableRow(b.name, `${b.fileCount} files`, 30));
        }
        console.log(chalk.dim('  ' + '─'.repeat(38)));
        console.log(tableRow('Total', `${summary.totalFiles} files`, 30));
        hasStorage = summary.totalFiles > 0;
      }
    } catch (err) {
      storageSpinner.fail(chalk.red('Failed to fetch local storage summary'));
      console.log(info(String(err)));
    }
    console.log('');
  }

  // Show target
  console.log(sectionTitle('Target'));
  console.log(tableRow('Cloud Project', maskUrl(config.cloud.projectUrl || config.cloud.databaseUrl), 20));
  console.log('');

  // 6. Warning — push is DESTRUCTIVE
  console.log(chalk.bold.red('  ⚠  WARNING: This is a DESTRUCTIVE operation.'));
  console.log(chalk.yellow('  The cloud database will be overwritten with local data.'));
  console.log(chalk.yellow('  Any data in the cloud that is not in the local database will be lost.'));
  console.log('');

  // 7. Confirm
  if (!options?.yes) {
    const proceed = await confirmDestructive(
      'Push local data to cloud database? This will OVERWRITE cloud data.',
    );
    if (!proceed) {
      console.log('');
      console.log(warn('Push cancelled.'));
      console.log('');
      return;
    }
  }

  console.log('');

  // 8. pg_dump local — dump local database
  const dumpSpinner = ora('Dumping local database...').start();
  let dumpPath: string;
  try {
    dumpPath = await dumpDatabase(config.local.databaseUrl, {
      schemas: config.sync.schemas,
      excludeTables: config.sync.excludeTables,
      dumpFlags: config.sync.dumpOptions,
    });
    dumpSpinner.succeed(chalk.green('Local database dumped'));
    console.log(info(`Dump file: ${dumpPath}`));
  } catch (err) {
    dumpSpinner.fail(chalk.red('Failed to dump local database'));
    console.log(info(String(err)));
    console.log('');
    return;
  }

  // 9. psql restore — restore to cloud database
  if (isPooledUrl(config.cloud.databaseUrl)) {
    console.log(warn('Attempting restore through pooled connection — this may fail.'));
  }

  const restoreSpinner = ora('Restoring to cloud database...').start();
  try {
    await restoreDatabase(config.cloud.databaseUrl);
    restoreSpinner.succeed(chalk.green('Cloud database restored'));
  } catch (err) {
    restoreSpinner.fail(chalk.red('Failed to restore to cloud database'));
    console.log(info(String(err)));
    console.log('');
    return;
  }

  // 10. Storage sync (non-fatal)
  let storageFileCount = 0;
  if (config.cloud.serviceRoleKey && config.storage?.localS3 && hasStorage) {
    const storageSyncSpinner = ora('Pushing storage files to cloud...').start();
    try {
      storageFileCount = await pushStorage(
        config.cloud,
        config.storage.localS3,
      );
      storageSyncSpinner.succeed(chalk.green(`Storage synced (${storageFileCount} files)`));
    } catch (err) {
      storageSyncSpinner.warn(chalk.yellow('Storage sync failed (database was still pushed)'));
      console.log(info(String(err)));
    }
  }

  console.log('');

  // 11. Verify — test cloud and get counts
  const verifySpinner = ora('Verifying cloud data...').start();
  let cloudTables: TableInfo[] = [];
  try {
    const verifyConn = await testConnection(config.cloud.databaseUrl);
    if (!verifyConn.connected) {
      verifySpinner.warn(chalk.yellow('Could not verify cloud database'));
    } else {
      cloudTables = await getTableCounts(
        config.cloud.databaseUrl,
        config.sync.schemas,
        config.sync.excludeTables,
      );
      verifySpinner.succeed(chalk.green('Cloud data verified'));
    }
  } catch {
    verifySpinner.warn(chalk.yellow('Could not verify cloud database'));
  }

  // 12. Update config — save lastSync metadata
  const totalRows = cloudTables.length > 0
    ? cloudTables.reduce((sum, t) => sum + t.rowCount, 0)
    : localTables.reduce((sum, t) => sum + t.rowCount, 0);

  const updatedConfig: SyncConfig = {
    ...config,
    lastSync: {
      type: 'push',
      timestamp: new Date().toISOString(),
      tables: cloudTables.length > 0 ? cloudTables.length : localTables.length,
      rows: totalRows,
      files: storageFileCount,
    },
  };
  saveConfig(updatedConfig);

  // 13. Summary
  const tableCount = updatedConfig.lastSync!.tables;
  const rowCount = updatedConfig.lastSync!.rows;

  console.log('');
  console.log(success('Push complete!'));
  console.log(tableRow('Tables', String(tableCount), 20));
  console.log(tableRow('Rows', `~${rowCount}`, 20));
  if (storageFileCount > 0) {
    console.log(tableRow('Files', String(storageFileCount), 20));
  }
  console.log('');
}
