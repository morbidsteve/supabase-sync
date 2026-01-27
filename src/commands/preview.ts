import chalk from 'chalk';
import ora from 'ora';
import { select } from '@inquirer/prompts';
import { configExists, loadConfig } from '../core/config.js';
import { getTableCounts, type TableInfo } from '../db/discovery.js';
import { getSupabaseStorageSummary, type StorageSummary } from '../storage/supabase.js';
import { getS3StorageSummary } from '../storage/s3.js';
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
 * Print a table list showing what would be transferred.
 */
function printTransferSummary(tables: TableInfo[], direction: string): void {
  if (tables.length === 0) {
    console.log(info('No tables found to transfer'));
    return;
  }

  for (const t of tables) {
    const qualifiedName = `${t.schema}.${t.name}`;
    console.log(tableRow(qualifiedName, `~${t.rowCount} rows`, 30));
  }

  const totalRows = tables.reduce((sum, t) => sum + t.rowCount, 0);
  console.log(chalk.dim('  ' + '─'.repeat(38)));
  console.log(tableRow('Would transfer', `${tables.length} tables, ~${totalRows} rows ${direction}`, 30));
}

/**
 * Print storage transfer summary.
 */
function printStorageTransferSummary(summary: StorageSummary, direction: string): void {
  if (summary.buckets.length === 0) {
    console.log(info('No storage buckets to transfer'));
    return;
  }

  for (const b of summary.buckets) {
    const sizeStr = b.totalSize > 0 ? ` (${formatBytes(b.totalSize)})` : '';
    console.log(tableRow(b.name, `${b.fileCount} files${sizeStr}`, 30));
  }

  const totalSizeStr = summary.totalSize > 0 ? ` (${formatBytes(summary.totalSize)})` : '';
  console.log(chalk.dim('  ' + '─'.repeat(38)));
  console.log(tableRow('Would transfer', `${summary.totalFiles} files${totalSizeStr} ${direction}`, 30));
}

/**
 * Preview command — dry run showing what a pull or push would do.
 */
export async function previewCommand(): Promise<void> {
  // 1. Check for config
  if (!configExists()) {
    console.log(header('Supabase Sync — Preview'));
    console.log('');
    console.log(error('No configuration found.'));
    console.log(info('Run `supabase-sync init` to set up your project.'));
    console.log('');
    return;
  }

  const config = loadConfig();

  // 2. Need at least cloud credentials
  if (!config.cloud) {
    console.log(header('Supabase Sync — Preview'));
    console.log('');
    console.log(error('Cloud credentials are not configured.'));
    console.log(info('Run `supabase-sync init` or `supabase-sync settings` to configure.'));
    console.log('');
    return;
  }

  // 3. Determine direction
  let direction: 'pull' | 'push';

  if (config.cloud && config.local) {
    // Both configured — ask the user
    direction = await select({
      message: 'Which direction would you like to preview?',
      choices: [
        { name: 'Pull  (cloud -> local)', value: 'pull' as const },
        { name: 'Push  (local -> cloud)', value: 'push' as const },
      ],
    });
  } else {
    // Only cloud configured — default to pull
    direction = 'pull';
  }

  const isPull = direction === 'pull';
  const directionLabel = isPull ? 'Pull Preview (cloud -> local)' : 'Push Preview (local -> cloud)';
  const transferDirection = isPull ? '-> local' : '-> cloud';
  const sourceLabel = isPull ? 'Cloud' : 'Local';

  console.log(header(`Supabase Sync — ${directionLabel}`));
  console.log('');

  // 4. Determine source database URL
  const sourceDbUrl = isPull ? config.cloud!.databaseUrl : config.local?.databaseUrl;

  if (!sourceDbUrl) {
    console.log(error(`${sourceLabel} database URL is not configured.`));
    console.log(info('Run `supabase-sync settings` to configure.'));
    console.log('');
    return;
  }

  // 5. Fetch and display source table counts
  console.log(sectionTitle(`${sourceLabel} Database Tables`));
  const tableSpinner = ora(`Fetching ${sourceLabel.toLowerCase()} table counts...`).start();

  try {
    const tables = await getTableCounts(
      sourceDbUrl,
      config.sync.schemas,
      config.sync.excludeTables,
    );
    tableSpinner.stop();
    printTransferSummary(tables, transferDirection);
  } catch (err) {
    tableSpinner.fail(chalk.red(`Failed to fetch ${sourceLabel.toLowerCase()} table counts`));
    console.log(info(String(err)));
  }

  console.log('');

  // 6. Fetch and display source storage summary
  if (isPull && config.cloud!.serviceRoleKey) {
    console.log(sectionTitle(`${sourceLabel} Storage`));
    const storageSpinner = ora('Fetching cloud storage summary...').start();
    try {
      const summary = await getSupabaseStorageSummary(config.cloud!);
      storageSpinner.stop();
      printStorageTransferSummary(summary, transferDirection);
    } catch (err) {
      storageSpinner.fail(chalk.red('Failed to fetch cloud storage summary'));
      console.log(info(String(err)));
    }
    console.log('');
  } else if (!isPull && config.storage?.enabled && config.storage.localS3) {
    console.log(sectionTitle(`${sourceLabel} Storage`));
    const storageSpinner = ora('Fetching local S3 storage summary...').start();
    try {
      const summary = await getS3StorageSummary(config.storage.localS3);
      storageSpinner.stop();
      printStorageTransferSummary(summary, transferDirection);
    } catch (err) {
      storageSpinner.fail(chalk.red('Failed to fetch local storage summary'));
      console.log(info(String(err)));
    }
    console.log('');
  } else {
    console.log(sectionTitle(`${sourceLabel} Storage`));
    if (isPull) {
      console.log(info('No service role key configured — cannot preview cloud storage.'));
    } else {
      console.log(info('Local S3 storage not configured.'));
    }
    console.log('');
  }

  // 7. Sync options summary
  console.log(sectionTitle('Sync Options'));
  console.log(tableRow('Schemas', config.sync.schemas.join(', ')));
  if (config.sync.excludeTables.length > 0) {
    console.log(tableRow('Excluded tables', config.sync.excludeTables.join(', ')));
  }
  console.log('');

  // 8. Dry run notice
  console.log(chalk.bgYellow.black(' DRY RUN ') + ' ' + chalk.yellow('This is a dry run — no changes were made.'));
  console.log('');
}
