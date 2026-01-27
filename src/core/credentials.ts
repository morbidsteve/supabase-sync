import { input, password, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { loadConfig, type CloudCredentials, type LocalCredentials } from './config.js';
import { scanEnvFiles } from './env.js';

export interface ResolvedCredentials {
  cloud: CloudCredentials;
  local: LocalCredentials;
}

function isSupabaseUrl(url: string): boolean {
  return url.includes('supabase.com') || url.includes('supabase.co');
}

function isLocalUrl(url: string): boolean {
  return url.includes('localhost') || url.includes('127.0.0.1');
}

/**
 * Derive a database URL template from a Supabase project URL.
 * The user will still need to fill in the password.
 */
function deriveDbUrlFromProject(projectUrl: string): string | undefined {
  const match = projectUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) return undefined;
  return `postgresql://postgres:[YOUR-PASSWORD]@db.${match[1]}.supabase.co:5432/postgres`;
}

/**
 * Auto-detect credentials from environment variables.
 * Checks common variable names used by Next.js, Vite, Expo, etc.
 */
export function detectFromEnv(envVars: Record<string, string>): {
  cloud: Partial<CloudCredentials>;
  local: Partial<LocalCredentials>;
} {
  const cloud: Partial<CloudCredentials> = {};
  const local: Partial<LocalCredentials> = {};

  // Cloud database URL
  const directDbUrl = envVars.DIRECT_DATABASE_URL;
  const dbUrl = envVars.DATABASE_URL;
  if (directDbUrl && isSupabaseUrl(directDbUrl)) {
    cloud.databaseUrl = directDbUrl;
  } else if (dbUrl && isSupabaseUrl(dbUrl)) {
    cloud.databaseUrl = dbUrl;
  }

  // Local database URL
  if (dbUrl && isLocalUrl(dbUrl)) {
    local.databaseUrl = dbUrl;
  }
  if (envVars.LOCAL_DATABASE_URL) {
    local.databaseUrl = envVars.LOCAL_DATABASE_URL;
  }

  // Project URL
  const projectUrlKeys = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
  ];
  for (const key of projectUrlKeys) {
    if (envVars[key]) {
      cloud.projectUrl = envVars[key];
      break;
    }
  }

  // Derive project URL from database URL if not found directly
  // Database URLs look like: postgresql://postgres:pass@db.PROJECTREF.supabase.co:5432/postgres
  if (!cloud.projectUrl && cloud.databaseUrl) {
    const refMatch = cloud.databaseUrl.match(/@db\.([a-z0-9]+)\.supabase\.co/);
    if (refMatch) {
      cloud.projectUrl = `https://${refMatch[1]}.supabase.co`;
    }
  }

  // Anon key
  const anonKeyKeys = [
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ];
  for (const key of anonKeyKeys) {
    if (envVars[key]) {
      cloud.anonKey = envVars[key];
      break;
    }
  }

  // Service role key
  const serviceKeyKeys = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'];
  for (const key of serviceKeyKeys) {
    if (envVars[key]) {
      cloud.serviceRoleKey = envVars[key];
      break;
    }
  }

  return { cloud, local };
}

/**
 * Resolve credentials from all sources.
 * Priority: config file > .env auto-detect > interactive prompt
 */
export async function resolveCredentials(options?: {
  requireCloud?: boolean;
  requireLocal?: boolean;
  interactive?: boolean;
}): Promise<Partial<ResolvedCredentials>> {
  const { requireCloud = false, requireLocal = false, interactive = true } = options || {};
  const config = loadConfig();

  // Start with config file values
  let cloud: Partial<CloudCredentials> = config.cloud ? { ...config.cloud } : {};
  let local: Partial<LocalCredentials> = config.local ? { ...config.local } : {};

  // Merge env file detections (config takes priority)
  const envVars = scanEnvFiles(process.cwd());
  const detected = detectFromEnv(envVars);

  cloud = { ...detected.cloud, ...cloud };
  local = { ...detected.local, ...local };

  // Interactive prompts for missing required fields
  if (interactive) {
    if (requireCloud) {
      if (!cloud.projectUrl) {
        cloud.projectUrl = await input({
          message: 'Supabase Project URL (e.g. https://xxxxx.supabase.co):',
          validate: (val) => val.includes('supabase.co') || val.includes('supabase.com') || 'Must be a Supabase URL',
        });
      } else {
        console.log(chalk.dim(`  Project URL: ${cloud.projectUrl} (auto-detected)`));
      }

      if (!cloud.databaseUrl) {
        cloud.databaseUrl = await input({
          message: 'Cloud database URL (direct connection, port 5432):',
          default: cloud.projectUrl ? deriveDbUrlFromProject(cloud.projectUrl) : undefined,
          validate: (val) => val.startsWith('postgresql://') || val.startsWith('postgres://') || 'Must be a PostgreSQL connection URL',
        });
      } else {
        console.log(chalk.dim(`  Database URL: detected from environment`));
      }

      if (!cloud.anonKey) {
        cloud.anonKey = await input({
          message: 'Supabase anon (public) key:',
          validate: (val) => val.length > 20 || 'Key seems too short',
        });
      }

      if (!cloud.serviceRoleKey) {
        const wantsServiceKey = await confirm({
          message: 'Do you have a service role key? (needed for storage access)',
          default: false,
        });
        if (wantsServiceKey) {
          cloud.serviceRoleKey = await password({
            message: 'Service role key:',
          });
        }
      }
    }

    if (requireLocal && !local.databaseUrl) {
      local.databaseUrl = await input({
        message: 'Local database URL:',
        default: 'postgresql://postgres:postgres@localhost:54322/postgres',
      });
    }
  }

  const result: Partial<ResolvedCredentials> = {};
  if (cloud.projectUrl && cloud.databaseUrl && cloud.anonKey) {
    result.cloud = cloud as CloudCredentials;
  }
  if (local.databaseUrl) {
    result.local = local as LocalCredentials;
  }

  return result;
}
