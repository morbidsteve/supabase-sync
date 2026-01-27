import { execa } from 'execa';

export interface TableInfo {
  schema: string;
  name: string;
  rowCount: number;
}

/**
 * Discover all user tables in the specified schemas.
 * Uses information_schema to find tables dynamically.
 */
export async function discoverTables(
  connectionUrl: string,
  schemas: string[] = ['public'],
  excludeTables: string[] = [],
): Promise<TableInfo[]> {
  const schemaList = schemas.map(s => `'${s}'`).join(',');
  const excludeList = excludeTables.length > 0
    ? `AND table_name NOT IN (${excludeTables.map(t => `'${t}'`).join(',')})`
    : '';

  const query = `
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN (${schemaList})
      AND table_name NOT LIKE 'pg_%'
      ${excludeList}
    ORDER BY table_schema, table_name;
  `;

  try {
    const result = await execa('psql', [
      connectionUrl,
      '--tuples-only',
      '--no-align',
      '--field-separator', '|',
      '-c', query,
    ]);

    const tables: TableInfo[] = [];
    for (const line of result.stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      const [schema, name] = line.split('|');
      if (schema && name) {
        tables.push({ schema: schema.trim(), name: name.trim(), rowCount: 0 });
      }
    }
    return tables;
  } catch {
    return [];
  }
}

/**
 * Get approximate row counts for all tables using pg_stat_user_tables.
 * This is fast (reads statistics, not actual rows).
 */
export async function getTableCounts(
  connectionUrl: string,
  schemas: string[] = ['public'],
  excludeTables: string[] = [],
): Promise<TableInfo[]> {
  const schemaList = schemas.map(s => `'${s}'`).join(',');
  const excludeList = excludeTables.length > 0
    ? `AND relname NOT IN (${excludeTables.map(t => `'${t}'`).join(',')})`
    : '';

  const query = `
    SELECT schemaname, relname, n_live_tup
    FROM pg_stat_user_tables
    WHERE schemaname IN (${schemaList})
      ${excludeList}
    ORDER BY schemaname, relname;
  `;

  try {
    const result = await execa('psql', [
      connectionUrl,
      '--tuples-only',
      '--no-align',
      '--field-separator', '|',
      '-c', query,
    ]);

    const tables: TableInfo[] = [];
    for (const line of result.stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length >= 3) {
        tables.push({
          schema: parts[0].trim(),
          name: parts[1].trim(),
          rowCount: parseInt(parts[2].trim(), 10) || 0,
        });
      }
    }
    return tables;
  } catch {
    return [];
  }
}

/**
 * Get exact row count for a single table.
 * Slower but accurate — use selectively.
 */
export async function getExactRowCount(
  connectionUrl: string,
  schema: string,
  table: string,
): Promise<number> {
  try {
    const result = await execa('psql', [
      connectionUrl,
      '--tuples-only',
      '--no-align',
      '-c', `SELECT count(*) FROM "${schema}"."${table}";`,
    ]);
    return parseInt(result.stdout.trim(), 10) || 0;
  } catch {
    return 0;
  }
}
