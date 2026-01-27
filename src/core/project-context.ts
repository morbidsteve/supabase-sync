import { select } from '@inquirer/prompts';
import { configExists } from './config.js';
import {
  type ProjectEntry,
  registryExists,
  listProjects,
  getProject,
  getDefaultProject,
  getProjectSnapshotDir,
  getProjectStorageDir,
} from './registry.js';

export interface ProjectContext {
  project: ProjectEntry;
  snapshotDir: string;
  storageDir: string;
}

/**
 * Resolve which project the user wants to operate on.
 *
 * Priority:
 *   1. --project flag (explicit ID)
 *   2. Single project in registry → use it
 *   3. Default project set → use it
 *   4. Multiple projects + interactive → show picker
 *   5. Legacy per-directory config → offer migration hint
 *   6. No project → return null
 */
export async function resolveProjectContext(options?: {
  projectId?: string;
  interactive?: boolean;
}): Promise<ProjectContext | null> {
  const interactive = options?.interactive ?? true;

  // 1. Explicit --project flag
  if (options?.projectId) {
    const project = getProject(options.projectId);
    if (!project) {
      console.log(`Project "${options.projectId}" not found in registry.`);
      return null;
    }
    return buildContext(project);
  }

  // 2/3/4. Check registry
  if (registryExists()) {
    const projects = listProjects();

    if (projects.length === 1) {
      return buildContext(projects[0]);
    }

    if (projects.length > 1) {
      const defaultProject = getDefaultProject();
      if (defaultProject && !interactive) {
        return buildContext(defaultProject);
      }

      if (interactive) {
        const choices = projects.map(p => ({
          name: `${p.name}${p.id === defaultProject?.id ? ' (default)' : ''}`,
          value: p.id,
        }));

        const selectedId = await select({
          message: 'Which project?',
          choices,
        });

        const selected = getProject(selectedId);
        if (!selected) return null;
        return buildContext(selected);
      }

      if (defaultProject) {
        return buildContext(defaultProject);
      }
    }
  }

  // 5. Legacy per-directory config
  if (configExists()) {
    return null; // Caller should handle migration hint
  }

  // 6. No project found
  return null;
}

/**
 * Check if a legacy per-directory config exists (for migration hints).
 */
export function hasLegacyConfig(): boolean {
  return configExists() && !registryExists();
}

function buildContext(project: ProjectEntry): ProjectContext {
  return {
    project,
    snapshotDir: getProjectSnapshotDir(project.id),
    storageDir: getProjectStorageDir(project.id),
  };
}
