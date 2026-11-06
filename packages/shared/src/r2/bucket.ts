// Bucket R2 de l'environnement — SOURCE UNIQUE du nom de bucket.
//
// Un environnement = un bucket (`savr-dev` pour l'aperçu et le poste local,
// `savr-prod` pour la production), désigné par `R2_BUCKET_NAME`. Le TYPE de
// fichier est un dossier de la clé (`bordereaux/…`, `logos/…`), jamais un
// bucket : aucun nom de bucket n'est écrit en dur dans le code (décision Val
// 2026-10-07). Avant, les PDF partaient dans deux buckets communs à dev et prod,
// et un `R2_BUCKET_NAME` absent retombait sur `savr-dev` — production comprise.
//
// Module sans dépendance (pas d'AWS SDK) : la garde des clés de logo
// (plateforme/lib/logo-key.ts) le lit depuis des routes qui ne font aucun appel R2.

/**
 * Nom du bucket R2 de l'environnement. Échoue (fail-closed) si `R2_BUCKET_NAME`
 * est absent, comme `getS3Client` pour les identifiants : pas de repli, un
 * environnement mal configuré ne doit jamais écrire chez un autre.
 */
export function bucketEnvironnement(): string {
  const bucket = process.env['R2_BUCKET_NAME'];
  if (!bucket) {
    throw new Error('Variable R2 manquante (R2_BUCKET_NAME)');
  }
  return bucket;
}
