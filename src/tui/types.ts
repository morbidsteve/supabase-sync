export type Screen = 'menu' | 'status' | 'pull' | 'push' | 'preview' | 'init' | 'settings';

export type TaskStatus = 'idle' | 'running' | 'success' | 'error' | 'warning';

export interface TaskStep {
  label: string;
  status: TaskStatus;
  detail?: string;
}
