// Client R2 (S3-compatible) partagé — upload d'objets binaires.
//
// SOURCE UNIQUE de la signature AWS Sig V4 (via @aws-sdk/client-s3). Réutilisée par :
//   - la Plateforme (PDF : packages/plateforme/.../r2-client.ts délègue ici),
//   - l'adapter MTS-1 (photos de collecte, sous packages/adapters/).
//
// ⚠ Garde-fou 3 (anti-couplage) : la logique R2/AWS-SDK vit ICI (shared), JAMAIS
// dans packages/adapters/ — l'adapter importe `uploadObject`, il ne réimplémente
// pas la signature. Les clés stockées en DB = "bucket/key", jamais d'URL signée.
//
// ⚠ Cloisonnement dev / prod : `uploadObject` et `getObject` ne prennent PAS de
// bucket. Ils visent toujours celui de l'environnement (./bucket.ts) — écrire ou
// lire ailleurs ne peut pas s'exprimer à l'appel. Seul endroit du dépôt qui
// construit un PutObjectCommand (verrouillé par upload.test.ts).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { bucketEnvironnement } from './bucket.js';

/**
 * Construit le client S3 pointant sur R2 (Cloudflare). Échoue (fail-closed) si les
 * variables d'environnement sont absentes — on ne « réussit » jamais un upload
 * silencieusement (sinon ligne shared.fichiers orpheline, BL-P0-02).
 */
export function getS3Client(): S3Client {
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

/** Objet écrit sur R2 : ce que l'appelant persiste (shared.fichiers, `*_url`). */
export interface ObjetStocke {
  /** Bucket réellement écrit = celui de l'environnement → `shared.fichiers.bucket`. */
  bucket: string;
  /** Clé dans le bucket → `shared.fichiers.key`. */
  key: string;
  /** Clé de stockage canonique "bucket/key" → colonnes `pdf_url`, `logo_url`. */
  storageKey: string;
}

/**
 * Upload binaire vers R2 (S3-compatible), dans le bucket de l'environnement. Lève
 * une erreur si l'upload échoue (variable ou credentials absents, rejet R2) →
 * l'appelant NE DOIT PAS persister de pointeur shared.fichiers tant que l'objet
 * n'est pas réellement écrit. Le bucket à persister est celui du retour, jamais
 * une valeur recalculée : le pointeur désigne ainsi exactement l'objet écrit.
 */
export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<ObjetStocke> {
  const bucket = bucketEnvironnement();
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { bucket, key, storageKey: `${bucket}/${key}` };
}

/**
 * Récupère un objet binaire depuis R2 (S3-compatible), dans le bucket de
 * l'environnement. Retourne le corps (Uint8Array) + le content-type. Utilisé par
 * le proxy d'affichage de logo (streaming via le serveur — pas d'URL publique R2
 * requise). Lève si l'objet est absent ou si la configuration manque.
 */
export async function getObject(
  key: string,
): Promise<{ body: Uint8Array; contentType: string }> {
  const client = getS3Client();
  const res = await client.send(
    new GetObjectCommand({ Bucket: bucketEnvironnement(), Key: key }),
  );
  const body = await res.Body!.transformToByteArray();
  return { body, contentType: res.ContentType ?? 'application/octet-stream' };
}
