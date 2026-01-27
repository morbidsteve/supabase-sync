import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Scan common env files in a directory and merge them.
 * Priority: .env.local > .env
 */
export function scanEnvFiles(dir: string): Record<string, string> {
  const files = ['.env', '.env.local'];
  let merged: Record<string, string> = {};
  for (const file of files) {
    const vars = readEnvFile(join(dir, file));
    merged = { ...merged, ...vars };
  }
  return merged;
}
