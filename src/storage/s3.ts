import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { S3Config } from '../core/config.js';
import type { StorageSummary } from './supabase.js';

function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region || 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? true,
  });
}

/**
 * Get a summary of all buckets and file counts from an S3-compatible store.
 */
export async function getS3StorageSummary(config: S3Config): Promise<StorageSummary> {
  const s3 = createS3Client(config);
  const result: StorageSummary = { buckets: [], totalFiles: 0, totalSize: 0 };

  try {
    const { Buckets } = await s3.send(new ListBucketsCommand({}));
    if (!Buckets) return result;

    for (const bucket of Buckets) {
      if (!bucket.Name) continue;
      const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: bucket.Name }));
      const fileCount = Contents?.length || 0;
      const totalSize = Contents?.reduce((sum, obj) => sum + (obj.Size || 0), 0) || 0;
      result.buckets.push({ name: bucket.Name, fileCount, totalSize });
      result.totalFiles += fileCount;
      result.totalSize += totalSize;
    }
  } catch {
    // S3 store not reachable
  }

  return result;
}

/**
 * Upload files from snapshot directory to an S3-compatible store.
 */
export async function uploadToS3(
  config: S3Config,
  snapshotStorageDir: string,
): Promise<number> {
  const s3 = createS3Client(config);
  if (!existsSync(snapshotStorageDir)) return 0;

  let fileCount = 0;
  const bucketDirs = readdirSync(snapshotStorageDir).filter(f =>
    statSync(join(snapshotStorageDir, f)).isDirectory()
  );

  for (const bucketName of bucketDirs) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucketName }));
    } catch {
      // Bucket may already exist
    }

    const bucketDir = join(snapshotStorageDir, bucketName);
    const files = readdirSync(bucketDir);

    for (const fileName of files) {
      const filePath = join(bucketDir, fileName);
      if (!statSync(filePath).isFile()) continue;
      const fileData = readFileSync(filePath);

      await s3.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: fileName,
        Body: fileData,
      }));
      fileCount++;
    }
  }

  return fileCount;
}

/**
 * Download files from an S3-compatible store to snapshot directory.
 */
export async function downloadFromS3(
  config: S3Config,
  snapshotStorageDir: string,
): Promise<number> {
  const s3 = createS3Client(config);
  if (!existsSync(snapshotStorageDir)) mkdirSync(snapshotStorageDir, { recursive: true });

  let fileCount = 0;

  try {
    const { Buckets } = await s3.send(new ListBucketsCommand({}));
    if (!Buckets) return 0;

    for (const bucket of Buckets) {
      if (!bucket.Name) continue;
      const bucketDir = join(snapshotStorageDir, bucket.Name);
      if (!existsSync(bucketDir)) mkdirSync(bucketDir, { recursive: true });

      const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: bucket.Name }));
      if (!Contents) continue;

      for (const obj of Contents) {
        if (!obj.Key) continue;
        const { Body } = await s3.send(new GetObjectCommand({
          Bucket: bucket.Name,
          Key: obj.Key,
        }));
        if (!Body) continue;

        const chunks: Buffer[] = [];
        for await (const chunk of Body as AsyncIterable<Buffer>) {
          chunks.push(chunk);
        }
        writeFileSync(join(bucketDir, obj.Key), Buffer.concat(chunks));
        fileCount++;
      }
    }
  } catch {
    // S3 store not reachable
  }

  return fileCount;
}
