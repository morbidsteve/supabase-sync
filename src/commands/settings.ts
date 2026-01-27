import chalk from 'chalk';
import ora from 'ora';
import { select, input, password, confirm } from '@inquirer/prompts';
import {
  configExists,
  loadConfig,
  saveConfig,
  type SyncConfig,
  type CloudCredentials,
  type LocalCredentials,
  type S3Config,
} from '../core/config.js';
import { ensureLocalDb, stopLocalDb, removeLocalDb, getLocalDbStatus } from '../docker/local-db.js';
import { testConnection } from '../db/connection.js';
import { header, success, warn, error, info, sectionTitle, tableRow } from '../ui/format.js';
import { confirmDestructive } from '../ui/prompts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask a sensitive value for display, showing only the start and end.
 */
function maskValue(value: string): string {
  if (value.length <= 16) return '****';
  return value.slice(0, 12) + '****' + value.slice(-6);
}

/**
 * Mask a short secret (key / password), showing only the last 4 chars.
 */
function maskSecret(value: string): string {
  if (value.length <= 8) return '****';
  return '****' + value.slice(-4);
}

/**
 * Print a high-level summary of the current configuration.
 */
function printConfigSummary(config: SyncConfig): void {
  console.log(sectionTitle('Current Configuration'));

  // Cloud
  if (config.cloud) {
    console.log(tableRow('Cloud project', maskValue(config.cloud.projectUrl)));
    console.log(tableRow('Cloud DB', maskValue(config.cloud.databaseUrl)));
    console.log(tableRow('Anon key', maskSecret(config.cloud.anonKey)));
    console.log(
      tableRow(
        'Service role key',
        config.cloud.serviceRoleKey ? maskSecret(config.cloud.serviceRoleKey) : chalk.dim('not set'),
      ),
    );
  } else {
    console.log(tableRow('Cloud', chalk.dim('not configured')));
  }

  // Local / Docker
  if (config.docker?.managed) {
    console.log(tableRow('Local DB', `Docker (${config.docker.containerName}, port ${config.docker.port})`));
  } else if (config.local) {
    console.log(tableRow('Local DB', config.local.databaseUrl));
  } else {
    console.log(tableRow('Local DB', chalk.dim('not configured')));
  }

  // Storage
  if (config.storage?.enabled) {
    console.log(tableRow('Storage', 'enabled'));
    if (config.storage.localS3) {
      console.log(tableRow('S3 endpoint', config.storage.localS3.endpoint));
    }
  } else {
    console.log(tableRow('Storage', chalk.dim('disabled')));
  }

  // Sync options
  console.log(tableRow('Schemas', config.sync.schemas.join(', ')));
  console.log(tableRow('Excluded tables', config.sync.excludeTables.length > 0 ? config.sync.excludeTables.join(', ') : chalk.dim('none')));
}

// ---------------------------------------------------------------------------
// Sub-actions
// ---------------------------------------------------------------------------

async function updateCloudCredentials(config: SyncConfig): Promise<void> {
  console.log(sectionTitle('Update Cloud Credentials'));
  console.log('');

  const projectUrl = await input({
    message: 'Supabase Project URL (e.g. https://xxxxx.supabase.co):',
    default: config.cloud?.projectUrl,
    validate: (val) =>
      val.includes('supabase.co') || val.includes('supabase.com') || 'Must be a Supabase URL',
  });

  const databaseUrl = await input({
    message: 'Cloud database URL (direct connection, port 5432):',
    default: config.cloud?.databaseUrl,
    validate: (val) =>
      val.startsWith('postgresql://') || val.startsWith('postgres://') || 'Must be a PostgreSQL connection URL',
  });

  const anonKey = await input({
    message: 'Supabase anon (public) key:',
    default: config.cloud?.anonKey,
    validate: (val) => val.length > 20 || 'Key seems too short',
  });

  const serviceRoleKey = await password({
    message: 'Service role key (leave blank to skip):',
  });

  const cloud: CloudCredentials = {
    projectUrl,
    databaseUrl,
    anonKey,
    ...(serviceRoleKey ? { serviceRoleKey } : config.cloud?.serviceRoleKey ? { serviceRoleKey: config.cloud.serviceRoleKey } : {}),
  };

  // Test connection
  console.log('');
  const spinner = ora('Testing cloud connection...').start();
  const result = await testConnection(cloud.databaseUrl);

  if (result.connected) {
    spinner.succeed(chalk.green('Cloud database connected'));
    if (result.version) {
      console.log(info(result.version));
    }
  } else {
    spinner.warn(chalk.yellow('Could not connect to cloud database'));
    if (result.error) {
      console.log(info(result.error.split('\n')[0]));
    }
    console.log(info('Credentials will be saved anyway — you can fix the URL later.'));
  }

  config.cloud = cloud;
  saveConfig(config);
  console.log(success('Cloud credentials saved'));
}

async function updateLocalCredentials(config: SyncConfig): Promise<void> {
  console.log(sectionTitle('Update Local Credentials'));
  console.log('');

  const databaseUrl = await input({
    message: 'Local database URL:',
    default: config.local?.databaseUrl || 'postgresql://postgres:postgres@localhost:54322/postgres',
  });

  const local: LocalCredentials = { databaseUrl };

  // Test connection
  console.log('');
  const spinner = ora('Testing local connection...').start();
  const result = await testConnection(local.databaseUrl);

  if (result.connected) {
    spinner.succeed(chalk.green('Local database connected'));
    if (result.version) {
      console.log(info(result.version));
    }
  } else {
    spinner.warn(chalk.yellow('Could not connect to local database'));
    if (result.error) {
      console.log(info(result.error.split('\n')[0]));
    }
    console.log(info('Credentials will be saved anyway — you can fix the URL later.'));
  }

  config.local = local;
  saveConfig(config);
  console.log(success('Local credentials saved'));
}

async function configureStorage(config: SyncConfig): Promise<void> {
  console.log(sectionTitle('Configure Storage'));
  console.log('');

  const currentlyEnabled = config.storage?.enabled ?? false;

  const enabled = await confirm({
    message: 'Enable storage sync?',
    default: currentlyEnabled,
  });

  if (!enabled) {
    config.storage = { enabled: false };
    saveConfig(config);
    console.log(success('Storage sync disabled'));
    return;
  }

  // Prompt for S3 configuration
  console.log('');
  console.log(info('Configure local S3-compatible storage (e.g. MinIO):'));

  const endpoint = await input({
    message: 'S3 endpoint URL:',
    default: config.storage?.localS3?.endpoint || 'http://localhost:9000',
  });

  const accessKeyId = await input({
    message: 'S3 access key ID:',
    default: config.storage?.localS3?.accessKeyId,
  });

  const secretAccessKey = await password({
    message: 'S3 secret access key:',
  });

  const region = await input({
    message: 'S3 region (optional):',
    default: config.storage?.localS3?.region || 'us-east-1',
  });

  const forcePathStyle = await confirm({
    message: 'Force path-style URLs? (required for MinIO)',
    default: config.storage?.localS3?.forcePathStyle ?? true,
  });

  const s3Config: S3Config = {
    endpoint,
    accessKeyId,
    secretAccessKey: secretAccessKey || config.storage?.localS3?.secretAccessKey || '',
    ...(region ? { region } : {}),
    forcePathStyle,
  };

  config.storage = { enabled: true, localS3: s3Config };
  saveConfig(config);
  console.log(success('Storage configuration saved'));
}

async function editSyncOptions(config: SyncConfig): Promise<void> {
  console.log(sectionTitle('Edit Sync Options'));
  console.log('');

  const schemasInput = await input({
    message: 'Schemas to sync (comma-separated):',
    default: config.sync.schemas.join(', '),
  });

  const excludeTablesInput = await input({
    message: 'Tables to exclude (comma-separated):',
    default: config.sync.excludeTables.join(', '),
  });

  config.sync.schemas = schemasInput
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  config.sync.excludeTables = excludeTablesInput
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  saveConfig(config);
  console.log(success('Sync options saved'));
  console.log(tableRow('Schemas', config.sync.schemas.join(', ')));
  console.log(tableRow('Excluded tables', config.sync.excludeTables.length > 0 ? config.sync.excludeTables.join(', ') : chalk.dim('none')));
}

async function testConnections(config: SyncConfig): Promise<void> {
  console.log(sectionTitle('Testing Connections'));
  console.log('');

  // Cloud
  if (config.cloud) {
    const spinner = ora('Testing cloud connection...').start();
    try {
      const result = await testConnection(config.cloud.databaseUrl);
      if (result.connected) {
        spinner.succeed(chalk.green('Cloud database connected'));
        if (result.version) {
          console.log(info(result.version));
        }
      } else {
        spinner.fail(chalk.red('Cloud database connection failed'));
        if (result.error) {
          console.log(info(result.error.split('\n')[0]));
        }
      }
    } catch (err) {
      spinner.fail(chalk.red('Cloud database connection failed'));
      console.log(info(String(err)));
    }
  } else {
    console.log(info('Cloud database: not configured'));
  }

  // Local
  if (config.local) {
    const spinner = ora('Testing local connection...').start();
    try {
      const result = await testConnection(config.local.databaseUrl);
      if (result.connected) {
        spinner.succeed(chalk.green('Local database connected'));
        if (result.version) {
          console.log(info(result.version));
        }
      } else {
        spinner.fail(chalk.red('Local database connection failed'));
        if (result.error) {
          console.log(info(result.error.split('\n')[0]));
        }
      }
    } catch (err) {
      spinner.fail(chalk.red('Local database connection failed'));
      console.log(info(String(err)));
    }
  } else {
    console.log(info('Local database: not configured'));
  }

  if (!config.cloud && !config.local) {
    console.log(warn('No credentials configured. Nothing to test.'));
  }
}

async function manageDockerDb(config: SyncConfig): Promise<void> {
  if (!config.docker?.managed) {
    console.log(info('No Docker-managed database configured.'));
    console.log(info('Run `supabase-sync init` and choose "Docker-managed database" to set one up.'));
    return;
  }

  const status = await getLocalDbStatus(config.docker.containerName);
  console.log(sectionTitle('Docker Database'));
  console.log(tableRow('Container', config.docker.containerName));
  console.log(tableRow('Volume', config.docker.volumeName));
  console.log(tableRow('Port', String(config.docker.port)));
  console.log(tableRow('Status', status.running ? chalk.green('running') : status.exists ? chalk.yellow('stopped') : chalk.dim('not created')));
  console.log('');

  type DockerAction = 'start' | 'stop' | 'remove' | 'back';
  const action = await select<DockerAction>({
    message: 'Docker database action:',
    choices: [
      { name: status.running ? 'Restart container' : 'Start container', value: 'start' },
      { name: 'Stop container', value: 'stop' },
      { name: 'Remove container and data', value: 'remove' },
      { name: 'Back', value: 'back' },
    ],
  });

  if (action === 'back') return;

  if (action === 'start') {
    const spinner = ora('Starting local database...').start();
    try {
      const url = await ensureLocalDb(config.docker);
      config.local = { databaseUrl: url };
      saveConfig(config);
      spinner.succeed(chalk.green(`Local database running on port ${config.docker.port}`));
    } catch (err) {
      spinner.fail(chalk.red('Failed to start local database'));
      console.log(info(String(err)));
    }
  } else if (action === 'stop') {
    const spinner = ora('Stopping local database...').start();
    try {
      await stopLocalDb(config.docker.containerName);
      spinner.succeed(chalk.green('Local database stopped'));
    } catch (err) {
      spinner.fail(chalk.red('Failed to stop local database'));
      console.log(info(String(err)));
    }
  } else if (action === 'remove') {
    const confirmed = await confirmDestructive('Remove Docker database container and all data?');
    if (confirmed) {
      const spinner = ora('Removing local database...').start();
      try {
        await removeLocalDb(config.docker.containerName, config.docker.volumeName);
        delete config.docker;
        delete config.local;
        saveConfig(config);
        spinner.succeed(chalk.green('Docker database removed'));
      } catch (err) {
        spinner.fail(chalk.red('Failed to remove local database'));
        console.log(info(String(err)));
      }
    }
  }
}

async function clearCloudCredentials(config: SyncConfig): Promise<void> {
  if (!config.cloud) {
    console.log(info('Cloud credentials are not configured — nothing to clear.'));
    return;
  }

  const confirmed = await confirmDestructive('Remove cloud credentials from configuration?');
  if (!confirmed) {
    console.log(info('Cancelled.'));
    return;
  }

  delete config.cloud;
  saveConfig(config);
  console.log(success('Cloud credentials removed'));
}

// ---------------------------------------------------------------------------
// Main settings command
// ---------------------------------------------------------------------------

type SettingsAction =
  | 'update_cloud'
  | 'update_local'
  | 'manage_docker'
  | 'configure_storage'
  | 'edit_sync'
  | 'test_connections'
  | 'clear_cloud'
  | 'back';

export async function settingsCommand(options?: { projectId?: string }): Promise<void> {
  // 1. Check for config
  if (!configExists()) {
    console.log(header('Supabase Sync — Settings'));
    console.log('');
    console.log(warn('No configuration found.'));
    console.log(info('Run `supabase-sync init` to set up your project first.'));
    console.log('');
    return;
  }

  // 2. Loop until Back
  while (true) {
    const config = loadConfig();

    console.log(header('Supabase Sync — Settings'));
    console.log('');
    printConfigSummary(config);
    console.log('');

    const action = await select<SettingsAction>({
      message: 'What would you like to configure?',
      choices: [
        { name: 'Update cloud credentials', value: 'update_cloud' },
        { name: 'Update local credentials', value: 'update_local' },
        { name: 'Manage Docker database', value: 'manage_docker' },
        { name: 'Configure storage', value: 'configure_storage' },
        { name: 'Edit sync options', value: 'edit_sync' },
        { name: 'Test connections', value: 'test_connections' },
        { name: 'Clear cloud credentials', value: 'clear_cloud' },
        { name: 'Back', value: 'back' },
      ],
    });

    if (action === 'back') {
      return;
    }

    console.log('');

    switch (action) {
      case 'update_cloud':
        await updateCloudCredentials(config);
        break;
      case 'update_local':
        await updateLocalCredentials(config);
        break;
      case 'manage_docker':
        await manageDockerDb(config);
        break;
      case 'configure_storage':
        await configureStorage(config);
        break;
      case 'edit_sync':
        await editSyncOptions(config);
        break;
      case 'test_connections':
        await testConnections(config);
        break;
      case 'clear_cloud':
        await clearCloudCredentials(config);
        break;
    }

    console.log('');
  }
}
