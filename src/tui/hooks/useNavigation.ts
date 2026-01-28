import { useState, useCallback } from 'react';
import type { Screen } from '../types.js';

export function useNavigation() {
  const [stack, setStack] = useState<Screen[]>(['menu']);

  const current = stack[stack.length - 1]!;

  const navigate = useCallback((screen: Screen) => {
    setStack((prev) => [...prev, screen]);
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  return { current, navigate, goBack };
}
