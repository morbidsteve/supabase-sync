import { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { StepList } from '../components/StepList.js';
import { StatusLine } from '../components/StatusLine.js';
import type { TaskStep } from '../types.js';
import {
  configExists,
  loadConfig,
  saveConfig,
  defaultConfig,
  type SyncConfig,
  type CloudCredentials,
  type LocalCredentials,
  type DockerConfig,
} from '../../core/config.js';
import { checkPrerequisites, testConnection } from '../../db/connection.js';
import { isDockerAvailable } from '../../docker/docker-check.js';
import { scanEnvFiles } from '../../core/env.js';
import { detectFromEnv } from '../../core/credentials.js';
import {
  detectRegion,
  isSupabaseDirectUrl,
  toPoolerUrl,
  SUPABASE_REGIONS,
} from '../../core/supabase-url.js';
import { findFreePort, ensureLocalDb } from '../../docker/local-db.js';
import { addProject, slugify } from '../../core/registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InitScreenProps {
  onBack: () => void;
}

type InitPhase =
  | 'prerequisites'
  | 'scanning'
  | 'cloudCredentials'
  | 'region'
  | 'localDb'
  | 'dockerSetup'
  | 'testing'
  | 'complete'
  | 'error';

type LocalDbChoice = 'docker' | 'existing' | 'skip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function maskValue(value: string): string {
  if (value.length <= 16) return '****';
  return value.slice(0, 12) + '****' + value.slice(-6);
}

// ---------------------------------------------------------------------------
// InitScreen
// ---------------------------------------------------------------------------

export function InitScreen({ onBack }: InitScreenProps) {
  const [phase, setPhase] = useState<InitPhase>('prerequisites');
  const [errorMessage, setErrorMessage] = useState('');

  // Prerequisites
  const [prereqSteps, setPrereqSteps] = useState<TaskStep[]>([]);
  const [prereqResult, setPrereqResult] = useState<{
    mode: 'native' | 'docker' | 'none';
    dockerAvailable: boolean;
  } | null>(null);

  // Scanning
  const [scanSteps, setScanSteps] = useState<TaskStep[]>([]);
  const [detectedCloud, setDetectedCloud] = useState<Partial<CloudCredentials>>({});
  const [detectedLocal, setDetectedLocal] = useState<Partial<LocalCredentials>>({});

  // Cloud credentials form
  const [cloudField, setCloudField] = useState(0);
  const [projectUrl, setProjectUrl] = useState('');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [serviceRoleKey, setServiceRoleKey] = useState('');

  // Region
  const [region, setRegion] = useState<string | null>(null);
  const [regionDetecting, setRegionDetecting] = useState(false);
  const [needsManualRegion, setNeedsManualRegion] = useState(false);

  // Local DB
  const [localDbChoice, setLocalDbChoice] = useState<LocalDbChoice | null>(null);
  const [localDbUrl, setLocalDbUrl] = useState('postgresql://postgres:postgres@localhost:54322/postgres');
  const [showLocalUrlInput, setShowLocalUrlInput] = useState(false);

  // Docker setup
  const [dockerSteps, setDockerSteps] = useState<TaskStep[]>([]);
  const [dockerConfig, setDockerConfig] = useState<DockerConfig | undefined>();
  const [localUrl, setLocalUrl] = useState<string | undefined>();

  // Testing
  const [testSteps, setTestSteps] = useState<TaskStep[]>([]);

  // Complete
  const [summary, setSummary] = useState<{
    cloudConfigured: boolean;
    localConfigured: boolean;
    mode: string;
    schemas: string[];
  } | null>(null);

  // Allow any key to return on terminal phases
  useInput((_input, _key) => {
    if (phase === 'complete' || phase === 'error') {
      onBack();
    }
  });

  // -------------------------------------------------------------------------
  // Phase: prerequisites
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'prerequisites') return;
    let cancelled = false;

    async function run() {
      const steps: TaskStep[] = [
        { label: 'Checking psql / pg_dump...', status: 'running' },
        { label: 'Checking Docker...', status: 'idle' },
      ];
      setPrereqSteps([...steps]);

      const prereqs = await checkPrerequisites();
      if (cancelled) return;

      if (prereqs.mode === 'native') {
        steps[0] = { label: 'psql / pg_dump available (native)', status: 'success' };
      } else if (prereqs.mode === 'docker') {
        steps[0] = { label: 'psql / pg_dump available (via Docker)', status: 'success' };
      } else {
        steps[0] = { label: 'psql / pg_dump not found', status: 'error' };
      }

      steps[1] = { label: 'Checking Docker...', status: 'running' };
      setPrereqSteps([...steps]);

      const docker = await isDockerAvailable();
      if (cancelled) return;

      if (docker) {
        steps[1] = { label: 'Docker available', status: 'success' };
      } else {
        steps[1] = { label: 'Docker not available', status: 'warning' };
      }
      setPrereqSteps([...steps]);

      if (prereqs.mode === 'none') {
        setErrorMessage(
          'Neither psql/pg_dump nor Docker found. Install Docker (https://docker.com) or PostgreSQL client tools.'
        );
        setPhase('error');
        return;
      }

      setPrereqResult({ mode: prereqs.mode, dockerAvailable: docker });

      if (!cancelled) {
        setPhase('scanning');
      }
    }

    run();
    return () => { cancelled = true; };
  }, [phase]);

  // -------------------------------------------------------------------------
  // Phase: scanning
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'scanning') return;
    let cancelled = false;

    async function run() {
      const steps: TaskStep[] = [
        { label: 'Scanning .env files...', status: 'running' },
      ];
      setScanSteps([...steps]);

      const cwd = process.cwd();
      const envVars = scanEnvFiles(cwd);
      if (cancelled) return;
      const envKeyCount = Object.keys(envVars).length;

      if (envKeyCount > 0) {
        const detected = detectFromEnv(envVars);
        setDetectedCloud(detected.cloud);
        setDetectedLocal(detected.local);

        // Pre-fill cloud credential form
        if (detected.cloud.projectUrl) setProjectUrl(detected.cloud.projectUrl);
        if (detected.cloud.databaseUrl) setDatabaseUrl(detected.cloud.databaseUrl);
        if (detected.cloud.anonKey) setAnonKey(detected.cloud.anonKey);
        if (detected.cloud.serviceRoleKey) setServiceRoleKey(detected.cloud.serviceRoleKey);

        const foundItems: string[] = [];
        if (detected.cloud.projectUrl) foundItems.push('Project URL');
        if (detected.cloud.databaseUrl) foundItems.push('Database URL');
        if (detected.cloud.anonKey) foundItems.push('Anon Key');
        if (detected.cloud.serviceRoleKey) foundItems.push('Service Role Key');

        steps[0] = {
          label: `Found ${envKeyCount} variable(s) in .env files`,
          status: 'success',
          detail: foundItems.length > 0 ? `Detected: ${foundItems.join(', ')}` : undefined,
        };
      } else {
        steps[0] = {
          label: 'No .env files found',
          status: 'warning',
          detail: 'Will prompt for credentials',
        };
      }
      setScanSteps([...steps]);

      if (!cancelled) {
        setPhase('cloudCredentials');
      }
    }

    run();
    return () => { cancelled = true; };
  }, [phase]);

  // -------------------------------------------------------------------------
  // Phase: cloudCredentials (form rendering handled below)
  // -------------------------------------------------------------------------
  const handleCloudFieldSubmit = useCallback(
    (fieldIndex: number) => {
      if (fieldIndex < 3) {
        setCloudField(fieldIndex + 1);
      } else {
        // All fields submitted, advance to region
        setPhase('region');
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Phase: region
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'region') return;
    let cancelled = false;

    async function run() {
      // Only detect region if the database URL looks like a Supabase direct URL
      if (!databaseUrl || !isSupabaseDirectUrl(databaseUrl)) {
        // Try to detect region from pooler URL format
        const regionMatch = databaseUrl.match(/aws-0-([a-z0-9-]+)\.pooler\.supabase\.com/);
        if (regionMatch) {
          setRegion(regionMatch[1]);
          if (!cancelled) {
            setPhase('localDb');
          }
          return;
        }

        // No region detection needed for non-Supabase URLs
        setRegion(null);
        if (!cancelled) {
          setPhase('localDb');
        }
        return;
      }

      setRegionDetecting(true);

      const detected = await detectRegion(databaseUrl);
      if (cancelled) return;

      setRegionDetecting(false);

      if (detected) {
        setRegion(detected);
        if (!cancelled) {
          setPhase('localDb');
        }
      } else {
        // Need manual selection
        setNeedsManualRegion(true);
      }
    }

    run();
    return () => { cancelled = true; };
  }, [phase, databaseUrl]);

  const handleRegionSelect = useCallback(
    (item: { value: string }) => {
      setRegion(item.value);
      setPhase('localDb');
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Phase: localDb (selection rendered below)
  // -------------------------------------------------------------------------
  const handleLocalDbSelect = useCallback(
    (item: { value: LocalDbChoice }) => {
      setLocalDbChoice(item.value);
      if (item.value === 'docker') {
        setPhase('dockerSetup');
      } else if (item.value === 'existing') {
        setShowLocalUrlInput(true);
      } else {
        // skip
        setPhase('testing');
      }
    },
    [],
  );

  const handleLocalUrlSubmit = useCallback(() => {
    setLocalUrl(localDbUrl);
    setPhase('testing');
  }, [localDbUrl]);

  // -------------------------------------------------------------------------
  // Phase: dockerSetup
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'dockerSetup') return;
    let cancelled = false;

    async function run() {
      if (!prereqResult?.dockerAvailable) {
        setErrorMessage('Docker is not available. Install Docker first: https://docker.com');
        setPhase('error');
        return;
      }

      const steps: TaskStep[] = [
        { label: 'Finding free port...', status: 'running' },
      ];
      setDockerSteps([...steps]);

      try {
        const port = await findFreePort();
        if (cancelled) return;

        steps[0] = { label: `Using port ${port}`, status: 'success' };
        steps.push({ label: 'Creating Docker container...', status: 'running' });
        setDockerSteps([...steps]);

        const containerName = `supabase-sync-pg-${Date.now()}`;
        const volumeName = `${containerName}-data`;

        const docker: DockerConfig = {
          managed: true,
          containerName,
          volumeName,
          port,
        };

        const url = await ensureLocalDb(docker);
        if (cancelled) return;

        steps[1] = {
          label: `Container "${containerName}" running on port ${port}`,
          status: 'success',
        };
        setDockerSteps([...steps]);

        setDockerConfig(docker);
        setLocalUrl(url);

        if (!cancelled) {
          setPhase('testing');
        }
      } catch (err) {
        if (cancelled) return;
        steps[steps.length - 1] = {
          label: 'Failed to create Docker container',
          status: 'error',
          detail: String(err),
        };
        setDockerSteps([...steps]);
        setErrorMessage('Failed to create Docker-managed database.');
        setPhase('error');
      }
    }

    run();
    return () => { cancelled = true; };
  }, [phase, prereqResult]);

  // -------------------------------------------------------------------------
  // Phase: testing
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'testing') return;
    let cancelled = false;

    async function run() {
      const steps: TaskStep[] = [];

      // Test cloud connection
      const hasCloud = !!(projectUrl && databaseUrl && anonKey);
      if (hasCloud) {
        // Convert to pooler URL if we detected a region
        let cloudDbUrl = databaseUrl;
        if (region && isSupabaseDirectUrl(databaseUrl)) {
          const poolerUrl = toPoolerUrl(databaseUrl, region);
          if (poolerUrl) cloudDbUrl = poolerUrl;
        }

        steps.push({ label: 'Testing cloud connection...', status: 'running' });
        setTestSteps([...steps]);

        const cloudConn = await testConnection(cloudDbUrl);
        if (cancelled) return;

        if (cloudConn.connected) {
          steps[steps.length - 1] = {
            label: 'Cloud database connected',
            status: 'success',
            detail: cloudConn.version,
          };
        } else {
          steps[steps.length - 1] = {
            label: 'Cloud connection failed (can fix later in settings)',
            status: 'warning',
            detail: cloudConn.error?.split('\n')[0],
          };
        }
        setTestSteps([...steps]);
      }

      // Test local connection
      if (localUrl) {
        steps.push({ label: 'Testing local connection...', status: 'running' });
        setTestSteps([...steps]);

        const localConn = await testConnection(localUrl);
        if (cancelled) return;

        if (localConn.connected) {
          steps[steps.length - 1] = {
            label: 'Local database connected',
            status: 'success',
            detail: localConn.version,
          };
        } else {
          steps[steps.length - 1] = {
            label: 'Local connection failed (can fix later in settings)',
            status: 'warning',
            detail: localConn.error?.split('\n')[0],
          };
        }
        setTestSteps([...steps]);
      }

      if (steps.length === 0) {
        steps.push({ label: 'No connections to test', status: 'warning' });
        setTestSteps([...steps]);
      }

      if (!cancelled) {
        setPhase('complete');
      }
    }

    run();
    return () => { cancelled = true; };
  }, [phase, projectUrl, databaseUrl, anonKey, region, localUrl]);

  // -------------------------------------------------------------------------
  // Phase: complete
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase !== 'complete') return;

    try {
      // Build cloud credentials
      let cloudDbUrl = databaseUrl;
      if (region && isSupabaseDirectUrl(databaseUrl)) {
        const poolerUrl = toPoolerUrl(databaseUrl, region);
        if (poolerUrl) cloudDbUrl = poolerUrl;
      }

      const hasCloud = !!(projectUrl && databaseUrl && anonKey);
      const cloud: CloudCredentials | undefined = hasCloud
        ? {
            projectUrl,
            databaseUrl: cloudDbUrl,
            anonKey,
            ...(serviceRoleKey ? { serviceRoleKey } : {}),
            ...(region ? { region } : {}),
          }
        : undefined;

      const local: LocalCredentials | undefined = localUrl
        ? { databaseUrl: localUrl }
        : undefined;

      const config: SyncConfig = {
        ...defaultConfig(),
        cloud,
        local,
        docker: dockerConfig,
      };

      saveConfig(config);

      // Register project in global registry
      const projectName = cloud?.projectUrl
        ? new URL(cloud.projectUrl).hostname.split('.')[0]
        : 'my-project';
      const projectId = slugify(projectName);
      const now = new Date().toISOString();

      try {
        addProject({
          id: projectId,
          name: projectName,
          cloud,
          local,
          docker: dockerConfig,
          sync: config.sync,
          createdAt: now,
          updatedAt: now,
        });
      } catch {
        // Project may already exist; non-fatal
      }

      setSummary({
        cloudConfigured: !!cloud,
        localConfigured: !!local,
        mode: prereqResult?.mode === 'native' ? 'native (psql/pg_dump)' : 'Docker',
        schemas: config.sync.schemas,
      });
    } catch (err) {
      setErrorMessage(`Failed to save configuration: ${String(err)}`);
      setPhase('error');
    }
  }, [phase]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const cloudFields = [
    { label: 'Project URL', value: projectUrl, onChange: setProjectUrl },
    { label: 'Database URL', value: databaseUrl, onChange: setDatabaseUrl },
    { label: 'Anon Key', value: anonKey, onChange: setAnonKey },
    { label: 'Service Role Key (optional)', value: serviceRoleKey, onChange: setServiceRoleKey },
  ];

  const regionItems = SUPABASE_REGIONS.map((r) => ({ label: r, value: r }));

  const localDbItems: { label: string; value: LocalDbChoice }[] = [
    { label: 'Create a Docker-managed database (recommended)', value: 'docker' },
    { label: 'Use an existing database (provide URL)', value: 'existing' },
    { label: 'Skip for now', value: 'skip' },
  ];

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>Project Initialization Wizard</Text>
      </Box>

      {/* Phase: prerequisites */}
      {prereqSteps.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Prerequisites</Text>
          <StepList steps={prereqSteps} />
        </Box>
      )}

      {/* Phase: scanning */}
      {scanSteps.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Environment Scan</Text>
          <StepList steps={scanSteps} />
        </Box>
      )}

      {/* Phase: cloudCredentials */}
      {phase === 'cloudCredentials' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Cloud Credentials</Text>
          <Text dimColor>Press Enter to advance, fill in each field</Text>
          <Box flexDirection="column" marginTop={1}>
            {cloudFields.map((f, i) => (
              <Box key={f.label} gap={1}>
                <Text>{f.label + ':'}</Text>
                {i === cloudField ? (
                  <TextInput
                    value={f.value}
                    onChange={f.onChange}
                    onSubmit={() => handleCloudFieldSubmit(i)}
                  />
                ) : i < cloudField ? (
                  <Text dimColor>{f.value ? maskValue(f.value) : '(empty)'}</Text>
                ) : (
                  <Text dimColor>{f.value ? '(pre-filled)' : '(empty)'}</Text>
                )}
                {i === cloudField && <Text color="cyan">{' <'}</Text>}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Phase: region */}
      {phase === 'region' && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Region Detection</Text>
          {regionDetecting && (
            <StepList steps={[{ label: 'Auto-detecting region...', status: 'running' }]} />
          )}
          {needsManualRegion && (
            <Box flexDirection="column">
              <Text dimColor>Could not auto-detect region. Please select:</Text>
              <SelectInput items={regionItems} onSelect={handleRegionSelect} />
            </Box>
          )}
        </Box>
      )}

      {/* Phase: localDb */}
      {phase === 'localDb' && (
        <Box flexDirection="column" marginBottom={1}>
          {region && (
            <Box marginBottom={1}>
              <StepList
                steps={[{ label: `Region: ${region}`, status: 'success' }]}
              />
            </Box>
          )}
          <Text bold>Local Database</Text>
          {!showLocalUrlInput ? (
            <Box flexDirection="column">
              <Text dimColor>How would you like to set up your local database?</Text>
              <SelectInput items={localDbItems} onSelect={handleLocalDbSelect} />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text dimColor>Enter your local database URL:</Text>
              <Box gap={1} marginTop={1}>
                <Text>Database URL:</Text>
                <TextInput
                  value={localDbUrl}
                  onChange={setLocalDbUrl}
                  onSubmit={handleLocalUrlSubmit}
                />
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Phase: dockerSetup */}
      {dockerSteps.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Docker Setup</Text>
          <StepList steps={dockerSteps} />
        </Box>
      )}

      {/* Phase: testing */}
      {testSteps.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Connection Tests</Text>
          <StepList steps={testSteps} />
        </Box>
      )}

      {/* Phase: complete */}
      {phase === 'complete' && summary && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>Setup complete!</Text>
          <Box flexDirection="column" marginTop={1}>
            <StatusLine label="Config file" value=".supabase-sync.json" />
            <StatusLine label="Cloud DB" value={summary.cloudConfigured ? 'configured' : 'not configured'} />
            <StatusLine label="Local DB" value={summary.localConfigured ? 'configured' : 'not configured'} />
            <StatusLine label="Execution mode" value={summary.mode} />
            <StatusLine label="Schemas" value={summary.schemas.join(', ')} />
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Next steps:</Text>
            {!summary.localConfigured && (
              <Text dimColor>  - Set up a local database via settings</Text>
            )}
            <Text dimColor>  - Pull cloud data:  supabase-sync pull</Text>
            <Text dimColor>  - Check status:     supabase-sync status</Text>
          </Box>
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
    </Box>
  );
}
