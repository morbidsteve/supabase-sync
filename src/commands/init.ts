import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import {
  configExists,
  saveConfig,
  defaultConfig,
  type SyncConfig,
} from '../core/config.js';
import { scanEnvFiles } from '../core/env.js';
import { detectFromEnv, resolveCredentials } from '../core/credentials.js';
import { testConnection, isPooledUrl, checkPrerequisites } from '../db/connection.js';
import { header, success, warn, error, info, sectionTitle, tableRow } from '../ui/format.js';
import { confirmAction } from '../ui/prompts.js';

const GITIGNORE_ENTRIES = [
  '.supabase-sync.json',
  '.supabase-sync/',
  '*.sql.bak',
];

/**
 * Update .gitignore in the given directory to include supabase-sync entries.
 * Idempotent — only adds entries that are not already present.
 */
function updateGitignore(dir: string): { added: string[]; alreadyPresent: string[] } {
  const gitignorePath = join(dir, '.gitignore');
  let content = '';

  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf-8');
  }

  const lines = content.split('\n');
  const added: string[] = [];
  const alreadyPresent: string[] = [];

  for (const entry of GITIGNORE_ENTRIES) {
    if (lines.some((line) => line.trim() === entry)) {
      alreadyPresent.push(entry);
    } else {
      added.push(entry);
    }
  }

  if (added.length > 0) {
    const suffix = content.endsWith('\n') || content === '' ? '' : '\n';
    const sectionHeader = '\n# supabase-sync\n';
    const newEntries = added.join('\n') + '\n';
    writeFileSync(gitignorePath, content + suffix + sectionHeader + newEntries, 'utf-8');
  }

  return { added, alreadyPresent };
}

/**
 * Initialize supabase-sync configuration in the current directory.
 */
export async function initCommand(): Promise<void> {
  const cwd = process.cwd();

  // 1. Print header
  console.log(header('Supabase Sync — Init'));
  console.log('');

  // 2. Check if config already exists
  if (configExists()) {
    console.log(warn('A .supabase-sync.json config file already exists in this directory.'));
    const overwrite = await confirmAction('Overwrite existing configuration?', false);
    if (!overwrite) {
      console.log(info('Init cancelled.'));
      return;
    }
    console.log('');
  }

  // 3. Check prerequisites
  console.log(sectionTitle('Checking prerequisites...'));
  const prereqs = await checkPrerequisites();
  if (prereqs.psql) {
    console.log(success('psql is available'));
  } else {
    console.log(warn('psql not found — you will need it for sync operations'));
  }
  if (prereqs.pgDump) {
    console.log(success('pg_dump is available'));
  } else {
    console.log(warn('pg_dump not found — you will need it for sync operations'));
  }
  console.log('');

  // 4. Scan .env files
  console.log(sectionTitle('Scanning environment files...'));
  const envVars = scanEnvFiles(cwd);
  const envKeyCount = Object.keys(envVars).length;

  if (envKeyCount > 0) {
    console.log(success(`Found ${envKeyCount} variable(s) in .env files`));
    const detected = detectFromEnv(envVars);

    if (detected.cloud.projectUrl) {
      console.log(tableRow('Project URL', maskValue(detected.cloud.projectUrl)));
    }
    if (detected.cloud.databaseUrl) {
      console.log(tableRow('Cloud DB URL', maskValue(detected.cloud.databaseUrl)));
    }
    if (detected.cloud.anonKey) {
      console.log(tableRow('Anon Key', maskValue(detected.cloud.anonKey)));
    }
    if (detected.cloud.serviceRoleKey) {
      console.log(tableRow('Service Key', '****' + detected.cloud.serviceRoleKey.slice(-6)));
    }
    if (detected.local.databaseUrl) {
      console.log(tableRow('Local DB URL', detected.local.databaseUrl));
    }
  } else {
    console.log(info('No .env or .env.local files found — will prompt for credentials'));
  }
  console.log('');

  // 5. Resolve cloud credentials (required)
  console.log(sectionTitle('Cloud credentials'));
  const resolved = await resolveCredentials({
    requireCloud: true,
    requireLocal: false,
    interactive: true,
  });
  console.log('');

  // 6. Optionally resolve local credentials
  let hasLocal = false;
  const wantsLocal = await confirm({
    message: 'Do you have a local database URL to configure now?',
    default: false,
  });

  if (wantsLocal) {
    const localResolved = await resolveCredentials({
      requireCloud: false,
      requireLocal: true,
      interactive: true,
    });
    if (localResolved.local) {
      resolved.local = localResolved.local;
      hasLocal = true;
    }
  }
  console.log('');

  // 7. Test cloud connection if credentials were resolved
  if (resolved.cloud) {
    const dbUrl = resolved.cloud.databaseUrl;

    if (isPooledUrl(dbUrl)) {
      console.log(warn('Cloud URL appears to use PgBouncer (port 6543).'));
      console.log(info('pg_dump requires a direct connection (port 5432).'));
      console.log(info('Sync operations may fail with this URL.'));
      console.log('');
    }

    const spinner = ora('Testing cloud connection...').start();
    const connResult = await testConnection(dbUrl);

    if (connResult.connected) {
      spinner.succeed(chalk.green(`Connected to cloud database`));
      if (connResult.version) {
        console.log(info(connResult.version));
      }
    } else {
      spinner.warn(chalk.yellow('Could not connect to cloud database'));
      console.log(info('Connection error — you can fix this later in .supabase-sync.json'));
      if (connResult.error) {
        console.log(info(connResult.error.split('\n')[0]));
      }
    }
    console.log('');
  }

  // 8. Build and save config
  const config: SyncConfig = {
    ...defaultConfig(),
    cloud: resolved.cloud,
    local: resolved.local,
  };

  saveConfig(config);
  console.log(success('Configuration saved to .supabase-sync.json'));

  // 9. Update .gitignore
  const gitResult = updateGitignore(cwd);
  if (gitResult.added.length > 0) {
    console.log(success(`.gitignore updated — added: ${gitResult.added.join(', ')}`));
  } else {
    console.log(info('.gitignore already contains all required entries'));
  }
  console.log('');

  // 10. Print summary
  console.log(sectionTitle('Setup complete'));
  console.log(tableRow('Config file', '.supabase-sync.json'));
  console.log(tableRow('Cloud DB', resolved.cloud ? 'configured' : 'not configured'));
  console.log(tableRow('Local DB', hasLocal ? 'configured' : 'not configured'));
  console.log(tableRow('Prerequisites', prereqs.psql && prereqs.pgDump ? 'all found' : 'some missing'));
  console.log('');
  console.log(info('Next steps:'));
  if (!hasLocal) {
    console.log(info('  - Set up a local database and run: supabase-sync settings'));
  }
  console.log(info('  - Pull cloud data:  supabase-sync pull'));
  console.log(info('  - Check status:     supabase-sync status'));
  console.log('');
}

/**
 * Mask a URL or string value for display, showing only the start and end.
 */
function maskValue(value: string): string {
  if (value.length <= 16) return '****';
  return value.slice(0, 12) + '****' + value.slice(-6);
}
