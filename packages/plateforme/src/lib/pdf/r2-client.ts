// Client R2 (S3-compatible) pour upload et URL pré-signées.
// Les clés stockées = "bucket/key", jamais d'URL signée en DB.
//
// La signature AWS Sig V4 + l'upload binaire vivent dans @savr/shared/src/r2/upload
// (source unique réutilisée par la Plateforme ET l'adapter MTS-1). Ce module ne
// garde que ce qui est spécifique PDF (presign de download, lecture d'objet).

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, uploadObject } from '@savr/shared/src/r2/upload.js';

export type R2Bucket = 'bordereaux' | 'rapports';

export async function uploadPdf(
  bucket: R2Bucket,
  key: string,
  pdfBuffer: Buffer,
): Promise<string> {
  return uploadObject(bucket, key, pdfBuffer, 'application/pdf');
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

/** Télécharge les octets d'un objet R2 ("bucket/key") — utilisé pour le ZIP. */
export async function getObjectBytes(storageKey: string): Promise<Buffer> {
  const [bucket, ...keyParts] = storageKey.split('/');
  const key = keyParts.join('/');

  const client = getS3Client();
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}
