import chalk from 'chalk';
import ora from 'ora';
import { configExists, loadConfig, saveConfig, type SyncConfig } from '../core/config.js';
import { testConnection } from '../db/connection.js';
import { getTableCounts, type TableInfo } from '../db/discovery.js';
import { dumpDatabase } from '../db/dump.js';
import { restoreDatabase } from '../db/restore.js';
import { getSupabaseStorageSummary } from '../storage/supabase.js';
import { pullStorage } from '../storage/sync.js';
import { header, success, warn, error, info, sectionTitle, tableRow } from '../ui/format.js';
import { confirmAction } from '../ui/prompts.js';

/**
 * Mask a database URL for display, showing only the start and end.
 */
function maskUrl(url: string): string {
  if (url.length <= 30) return url;
  return url.slice(0, 20) + '...' + url.slice(-10);
}

/**
 * Pull command — dump cloud database and restore to local,
 * then sync storage files.
 */
export async function pullCommand(options?: { yes?: boolean }): Promise<void> {
  // 1. Config check
  if (!configExists()) {
    console.log(header('Supabase Sync — Pull'));
    console.log('');
    console.log(error('No configuration found.'));
    console.log(info('Run `supabase-sync init` to set up your project.'));
    console.log('');
    return;
  }

  const config = loadConfig();

  // 2. Cloud credential check
  if (!config.cloud) {
    console.log(header('Supabase Sync — Pull'));
    console.log('');
    console.log(error('Cloud credentials are not configured.'));
    console.log(info('Run `supabase-sync init` or `supabase-sync settings` to configure.'));
    console.log('');
    return;
  }

  // 3. Local DB check
  if (!config.local) {
    console.log(header('Supabase Sync — Pull'));
    console.log('');
    console.log(error('Local database is not configured.'));
    console.log(info('A local database is required as the pull target.'));
    console.log(info('Run `supabase-sync settings` to configure local credentials.'));
    console.log('');
    return;
  }

  console.log(header('Supabase Sync — Pull (cloud -> local)'));
  console.log('');

  // 4. Test connections
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

  console.log('');

  // 5. Preview — show what will be pulled
  console.log(sectionTitle('Cloud Database Tables'));
  const tableSpinner = ora('Fetching cloud table counts...').start();

  let cloudTables: TableInfo[] = [];
  try {
    cloudTables = await getTableCounts(
      config.cloud.databaseUrl,
      config.sync.schemas,
      config.sync.excludeTables,
    );
    tableSpinner.stop();

    if (cloudTables.length === 0) {
      console.log(info('No tables found in cloud database'));
    } else {
      for (const t of cloudTables) {
        const qualifiedName = `${t.schema}.${t.name}`;
        console.log(tableRow(qualifiedName, `~${t.rowCount} rows`, 30));
      }
      const totalRows = cloudTables.reduce((sum, t) => sum + t.rowCount, 0);
      console.log(chalk.dim('  ' + '─'.repeat(38)));
      console.log(tableRow('Total', `${cloudTables.length} tables, ~${totalRows} rows`, 30));
    }
  } catch (err) {
    tableSpinner.fail(chalk.red('Failed to fetch cloud table counts'));
    console.log(info(String(err)));
    console.log('');
    return;
  }

  console.log('');

  // Storage preview
  let hasStorage = false;
  let storageFileCount = 0;
  if (config.cloud.serviceRoleKey) {
    console.log(sectionTitle('Cloud Storage'));
    const storageSpinner = ora('Fetching cloud storage summary...').start();
    try {
      const summary = await getSupabaseStorageSummary(config.cloud);
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
      storageSpinner.fail(chalk.red('Failed to fetch cloud storage summary'));
      console.log(info(String(err)));
    }
    console.log('');
  }

  // Show target
  console.log(sectionTitle('Target'));
  console.log(tableRow('Local DB', maskUrl(config.local.databaseUrl), 20));
  console.log('');

  // 6. Confirm
  if (!options?.yes) {
    const proceed = await confirmAction(
      'Pull cloud data to local database?',
      true,
    );
    if (!proceed) {
      console.log('');
      console.log(warn('Pull cancelled.'));
      console.log('');
      return;
    }
  }

  console.log('');

  // 7. pg_dump — dump cloud database
  const dumpSpinner = ora('Dumping cloud database...').start();
  let dumpPath: string;
  try {
    dumpPath = await dumpDatabase(config.cloud.databaseUrl, {
      schemas: config.sync.schemas,
      excludeTables: config.sync.excludeTables,
      dumpFlags: config.sync.dumpOptions,
    });
    dumpSpinner.succeed(chalk.green('Cloud database dumped'));
    console.log(info(`Dump file: ${dumpPath}`));
  } catch (err) {
    dumpSpinner.fail(chalk.red('Failed to dump cloud database'));
    console.log(info(String(err)));
    console.log('');
    return;
  }

  // 8. psql restore — restore to local database
  const restoreSpinner = ora('Restoring to local database...').start();
  try {
    await restoreDatabase(config.local.databaseUrl);
    restoreSpinner.succeed(chalk.green('Local database restored'));
  } catch (err) {
    restoreSpinner.fail(chalk.red('Failed to restore to local database'));
    console.log(info(String(err)));
    console.log('');
    return;
  }

  // 9. Storage sync (non-fatal)
  if (config.cloud.serviceRoleKey && hasStorage) {
    const storageSyncSpinner = ora('Pulling storage files...').start();
    try {
      storageFileCount = await pullStorage(
        config.cloud,
        config.storage?.localS3,
      );
      storageSyncSpinner.succeed(chalk.green(`Storage synced (${storageFileCount} files)`));
    } catch (err) {
      storageSyncSpinner.warn(chalk.yellow('Storage sync failed (data was still pulled)'));
      console.log(info(String(err)));
    }
  }

  console.log('');

  // 10. Verify — test local and get counts
  const verifySpinner = ora('Verifying local data...').start();
  let localTables: TableInfo[] = [];
  try {
    const verifyConn = await testConnection(config.local.databaseUrl);
    if (!verifyConn.connected) {
      verifySpinner.warn(chalk.yellow('Could not verify local database'));
    } else {
      localTables = await getTableCounts(
        config.local.databaseUrl,
        config.sync.schemas,
        config.sync.excludeTables,
      );
      verifySpinner.succeed(chalk.green('Local data verified'));
    }
  } catch {
    verifySpinner.warn(chalk.yellow('Could not verify local database'));
  }

  // 11. Update config — save lastSync metadata
  const totalRows = localTables.length > 0
    ? localTables.reduce((sum, t) => sum + t.rowCount, 0)
    : cloudTables.reduce((sum, t) => sum + t.rowCount, 0);

  const updatedConfig: SyncConfig = {
    ...config,
    lastSync: {
      type: 'pull',
      timestamp: new Date().toISOString(),
      tables: localTables.length > 0 ? localTables.length : cloudTables.length,
      rows: totalRows,
      files: storageFileCount,
    },
  };
  saveConfig(updatedConfig);

  // 12. Summary
  const tableCount = updatedConfig.lastSync!.tables;
  const rowCount = updatedConfig.lastSync!.rows;

  console.log('');
  console.log(success(`Pull complete!`));
  console.log(tableRow('Tables', String(tableCount), 20));
  console.log(tableRow('Rows', `~${rowCount}`, 20));
  if (storageFileCount > 0) {
    console.log(tableRow('Files', String(storageFileCount), 20));
  }
  console.log('');
}
