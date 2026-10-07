// Client R2 (S3-compatible) pour upload et URL pré-signées.
// Les clés stockées = "bucket/key", jamais d'URL signée en DB.
//
// La signature AWS Sig V4 + l'upload binaire vivent dans @savr/shared/src/r2/upload
// (source unique réutilisée par la Plateforme ET l'adapter MTS-1). Ce module ne
// garde que ce qui est spécifique PDF (presign de download, lecture d'objet).
//
// Cloisonnement dev / prod : l'écriture vise toujours le bucket de l'environnement
// (uploadObject ne prend pas de bucket). La lecture, elle, part d'une clé
// "bucket/key" relue en base : `cleDeLEnvironnement` refuse tout autre bucket, pour
// qu'aucune URL ne soit signée vers le stockage d'un autre environnement.

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { bucketEnvironnement } from '@savr/shared/src/r2/bucket.js';
import {
  getS3Client,
  uploadObject,
  type ObjetStocke,
} from '@savr/shared/src/r2/upload.js';

/**
 * Dépose un PDF dans le bucket de l'environnement. `key` commence par le dossier
 * du document (`DOSSIER_STOCKAGE`, @savr/shared/src/pdf/document-types).
 */
export async function uploadPdf(
  key: string,
  pdfBuffer: Buffer,
): Promise<ObjetStocke> {
  return uploadObject(key, pdfBuffer, 'application/pdf');
}

/**
 * Découpe une clé de stockage "bucket/key" et exige le bucket de l'environnement.
 * Lève sinon : une clé d'un autre bucket (ligne héritée, base recopiée d'un autre
 * environnement) ne doit ni être signée ni être lue.
 *
 * Lève aussi sur une clé d'objet vide ou portant un segment vide, `.` ou `..` :
 * une URL signée sur la racine du bucket est, en S3, une demande de LISTAGE — et
 * ce bucket contient désormais tous les fichiers de l'environnement. Aucune clé
 * écrite par l'application n'a cette forme (revue sécurité 2026-10-07).
 */
function cleDeLEnvironnement(storageKey: string): {
  bucket: string;
  key: string;
} {
  const [bucket, ...segments] = storageKey.split('/');
  if (bucket !== bucketEnvironnement()) {
    throw new Error(
      `Clé de stockage hors du bucket de l'environnement (${bucket ?? ''})`,
    );
  }
  if (
    segments.length === 0 ||
    segments.some((s) => s === '' || s === '.' || s === '..')
  ) {
    throw new Error('Clé de stockage sans objet désigné dans le bucket');
  }
  return { bucket, key: segments.join('/') };
}

export async function getPresignedUrl(
  storageKey: string,
  expiresInSeconds = 900,
): Promise<string> {
  const { bucket, key } = cleDeLEnvironnement(storageKey);

  const client = getS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

/** Télécharge les octets d'un objet R2 ("bucket/key") — utilisé pour le ZIP. */
export async function getObjectBytes(storageKey: string): Promise<Buffer> {
  const { bucket, key } = cleDeLEnvironnement(storageKey);

  const client = getS3Client();
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}
