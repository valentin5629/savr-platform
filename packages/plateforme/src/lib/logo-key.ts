// Garde des clés de logo R2 (revue sécurité 2026-09-18).
//
// Une clé de logo (`organisations.logo_url`, `associations.logo_url`,
// `evenements.logo_client_organisateur_url`) est écrite par un client : via les
// routes API, mais aussi directement via PostgREST (UPDATE colonne-level accordé à
// `authenticated`). Toute lecture R2 d'une telle clé — inline PDF, proxy d'affichage —
// doit donc la borner au bucket applicatif et au préfixe `logos/`, sinon un client
// fait télécharger (et inliner dans SON PDF) n'importe quel objet : bordereaux,
// attestations, photos, synthèses d'autres organisations.
//
// Format = celui produit par les routes d'upload : `${bucket}/logos/${uuid}.${png|jpg}`.
// Miroir SQL : trigger `trg_garde_format_logo` (migration 20260919100000).

const CLE_LOGO =
  /^([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/(logos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg))$/;

/** Bucket R2 applicatif — même repli que les routes d'upload. */
export function bucketLogos(): string {
  return process.env['R2_BUCKET_NAME'] || 'savr-dev';
}

/**
 * Découpe une clé de logo « bucket/logos/<uuid>.(png|jpg) » si elle vise le bucket
 * applicatif ; `null` sinon (autre bucket, autre préfixe, format hors upload).
 */
export function parseCleLogo(
  storageKey: string | null | undefined,
): { bucket: string; key: string } | null {
  if (typeof storageKey !== 'string') return null;
  const m = CLE_LOGO.exec(storageKey);
  if (!m || m[1] !== bucketLogos()) return null;
  return { bucket: m[1], key: m[2]! };
}
