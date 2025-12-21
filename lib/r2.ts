import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// R2 Configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

// Check if R2 is configured
export function isR2Configured(): boolean {
  return Boolean(
    R2_ACCOUNT_ID &&
    R2_ACCESS_KEY_ID &&
    R2_SECRET_ACCESS_KEY &&
    R2_BUCKET_NAME &&
    R2_PUBLIC_URL
  );
}

// Lazy-initialized S3 client
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    if (!isR2Configured()) {
      throw new Error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_URL environment variables.');
    }

    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

/**
 * Get the public URL for a screenshot
 */
export function getR2PublicUrl(key: string): string {
  const baseUrl = R2_PUBLIC_URL.replace(/\/$/, '');
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  return `${baseUrl}/${cleanKey}`;
}

/**
 * Get the public URL base
 */
export function getR2PublicUrlBase(): string {
  return R2_PUBLIC_URL.replace(/\/$/, '');
}

/**
 * Upload a screenshot buffer to R2
 * @param slug - Template slug (used as filename without extension)
 * @param buffer - Image buffer (WebP format)
 * @returns Public URL of the uploaded image
 */
export async function uploadScreenshotToR2(slug: string, buffer: Buffer): Promise<string> {
  const client = getS3Client();
  const key = `${slug}.webp`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000', // 1 year cache
  });

  await client.send(command);

  return getR2PublicUrl(key);
}

/**
 * Upload a file from a local path to R2
 * @param slug - Template slug (used as filename without extension)
 * @param localPath - Path to the local file
 * @returns Public URL of the uploaded image
 */
export async function uploadScreenshotFileToR2(slug: string, localPath: string): Promise<string> {
  const fs = await import('fs/promises');
  const buffer = await fs.readFile(localPath);
  return uploadScreenshotToR2(slug, buffer);
}

/**
 * Check if a screenshot exists in R2
 */
export async function screenshotExistsInR2(slug: string): Promise<boolean> {
  const client = getS3Client();
  const key = `${slug}.webp`;

  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a screenshot from R2
 */
export async function deleteScreenshotFromR2(slug: string): Promise<void> {
  const client = getS3Client();
  const key = `${slug}.webp`;

  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  await client.send(command);
}

/**
 * Get R2 configuration status (for admin dashboard)
 */
export function getR2Config() {
  return {
    configured: isR2Configured(),
    accountId: R2_ACCOUNT_ID ? `${R2_ACCOUNT_ID.slice(0, 8)}...` : null,
    bucketName: R2_BUCKET_NAME || null,
    publicUrl: R2_PUBLIC_URL || null,
  };
}

/**
 * Test R2 write connectivity by uploading and deleting a test file.
 * Returns { ok: true } if successful, { ok: false, error: string } otherwise.
 */
export async function testR2WriteConnectivity(): Promise<{ ok: boolean; error?: string }> {
  if (!isR2Configured()) {
    return { ok: false, error: 'R2 is not configured' };
  }

  const testKey = `_preflight_test_${Date.now()}.txt`;
  const testContent = Buffer.from('preflight-check');

  try {
    const client = getS3Client();

    // Upload test file
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain',
    }));

    // Delete test file
    await client.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: testKey,
    }));

    return { ok: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMsg };
  }
}
