import { useState, useCallback } from 'react';
import type { TaskStep, TaskStatus } from '../types.js';

interface AsyncTaskState {
  steps: TaskStep[];
  overall: TaskStatus;
  error?: string;
}

const initialState: AsyncTaskState = {
  steps: [],
  overall: 'idle',
};

export function useAsyncTask() {
  const [state, setState] = useState<AsyncTaskState>(initialState);

  const addStep = useCallback((label: string) => {
    setState((prev) => ({
      ...prev,
      overall: 'running',
      steps: [...prev.steps, { label, status: 'running' }],
    }));
  }, []);

  const updateLastStep = useCallback((status: TaskStatus, detail?: string) => {
    setState((prev) => {
      if (prev.steps.length === 0) return prev;
      const steps = [...prev.steps];
      steps[steps.length - 1] = { ...steps[steps.length - 1]!, status, detail };
      return { ...prev, steps };
    });
  }, []);

  const complete = useCallback((status: TaskStatus, error?: string) => {
    setState((prev) => ({
      ...prev,
      overall: status,
      error,
    }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  return { state, addStep, updateLastStep, complete, reset };
}
