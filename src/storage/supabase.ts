import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import type { CloudCredentials } from '../core/config.js';

export interface StorageSummary {
  buckets: { name: string; fileCount: number; totalSize: number }[];
  totalFiles: number;
  totalSize: number;
}

function createSupabaseClient(creds: CloudCredentials) {
  return createClient(creds.projectUrl, creds.serviceRoleKey || creds.anonKey);
}

/**
 * Get a summary of all buckets and file counts in Supabase Storage.
 */
export async function getSupabaseStorageSummary(creds: CloudCredentials): Promise<StorageSummary> {
  const supabase = createSupabaseClient(creds);
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error || !buckets) return { buckets: [], totalFiles: 0, totalSize: 0 };

  const result: StorageSummary = { buckets: [], totalFiles: 0, totalSize: 0 };

  for (const bucket of buckets) {
    const { data: files } = await supabase.storage.from(bucket.name).list('', { limit: 1000 });
    const fileCount = files?.filter(f => f.name && !f.name.endsWith('/')).length || 0;
    result.buckets.push({ name: bucket.name, fileCount, totalSize: 0 });
    result.totalFiles += fileCount;
  }

  return result;
}

/**
 * Download all files from Supabase Storage to a local snapshot directory.
 */
export async function downloadSupabaseStorage(
  creds: CloudCredentials,
  snapshotStorageDir: string,
): Promise<number> {
  const supabase = createSupabaseClient(creds);
  if (!existsSync(snapshotStorageDir)) mkdirSync(snapshotStorageDir, { recursive: true });

  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets) return 0;

  let fileCount = 0;

  for (const bucket of buckets) {
    const bucketDir = join(snapshotStorageDir, bucket.name);
    if (!existsSync(bucketDir)) mkdirSync(bucketDir, { recursive: true });

    const { data: files } = await supabase.storage.from(bucket.name).list('', { limit: 1000 });
    if (!files) continue;

    for (const file of files) {
      if (!file.name || file.name.endsWith('/')) continue;
      const { data, error } = await supabase.storage.from(bucket.name).download(file.name);
      if (error || !data) continue;

      const filePath = join(bucketDir, file.name);
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, Buffer.from(await data.arrayBuffer()));
      fileCount++;
    }
  }

  return fileCount;
}

/**
 * Upload all files from a snapshot directory to Supabase Storage.
 */
export async function uploadToSupabaseStorage(
  creds: CloudCredentials,
  snapshotStorageDir: string,
): Promise<number> {
  const supabase = createSupabaseClient(creds);
  if (!existsSync(snapshotStorageDir)) return 0;

  let fileCount = 0;
  const bucketDirs = readdirSync(snapshotStorageDir).filter(f =>
    statSync(join(snapshotStorageDir, f)).isDirectory()
  );

  for (const bucketName of bucketDirs) {
    // Create bucket if it doesn't exist (ignore error if it does)
    await supabase.storage.createBucket(bucketName, { public: true });

    const bucketDir = join(snapshotStorageDir, bucketName);
    const files = readdirSync(bucketDir);

    for (const fileName of files) {
      const filePath = join(bucketDir, fileName);
      if (!statSync(filePath).isFile()) continue;
      const fileData = readFileSync(filePath);

      await supabase.storage.from(bucketName).upload(fileName, fileData, { upsert: true });
      fileCount++;
    }
  }

  return fileCount;
}
