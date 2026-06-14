// Client R2 (S3-compatible) pour upload et URL pré-signées.
// Les clés stockées = "bucket/key", jamais d'URL signée en DB.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getS3Client(): S3Client {
  const accountId = process.env['R2_ACCOUNT_ID'];
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Variables R2 manquantes (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)',
    );
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

export type R2Bucket = 'bordereaux' | 'rapports';

export async function uploadPdf(
  bucket: R2Bucket,
  key: string,
  pdfBuffer: Buffer,
): Promise<string> {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    }),
  );
  return `${bucket}/${key}`;
}

export async function getPresignedUrl(
  storageKey: string,
  expiresInSeconds = 900,
): Promise<string> {
  const [bucket, ...keyParts] = storageKey.split('/');
  const key = keyParts.join('/');

  const client = getS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}
