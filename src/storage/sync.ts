import { join } from 'path';
import { getSnapshotDir, type CloudCredentials, type S3Config } from '../core/config.js';
import { downloadSupabaseStorage, uploadToSupabaseStorage } from './supabase.js';
import { uploadToS3, downloadFromS3 } from './s3.js';

function getStorageSnapshotDir(baseDir?: string): string {
  return join(baseDir ?? getSnapshotDir(), 'storage');
}

/**
 * Pull storage: download from Supabase Storage to snapshot dir,
 * then optionally upload to a local S3-compatible store.
 */
export async function pullStorage(
  cloudCreds: CloudCredentials,
  localS3Config?: S3Config,
  storageDir?: string,
): Promise<number> {
  const dir = storageDir ?? getStorageSnapshotDir();

  // Download from Supabase to snapshot
  const fileCount = await downloadSupabaseStorage(cloudCreds, dir);

  // Optionally upload to local S3
  if (localS3Config && fileCount > 0) {
    await uploadToS3(localS3Config, dir);
  }

  return fileCount;
}

/**
 * Push storage: download from local S3 (or use snapshot dir),
 * then upload to Supabase Storage.
 */
export async function pushStorage(
  cloudCreds: CloudCredentials,
  localS3Config?: S3Config,
  storageDir?: string,
): Promise<number> {
  const dir = storageDir ?? getStorageSnapshotDir();

  // If local S3 is configured, download latest files to snapshot first
  if (localS3Config) {
    await downloadFromS3(localS3Config, dir);
  }

  // Upload from snapshot to Supabase
  const fileCount = await uploadToSupabaseStorage(cloudCreds, dir);

  return fileCount;
}
