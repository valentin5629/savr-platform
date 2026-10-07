/**
 * Validation serveur de `valeur` selon `type_valeur` (colonne de la ligne).
 * Sans elle, une liste envoyée en chaîne (`'["75","92"]'`) est stockée comme
 * scalaire JSON et `fn_calculer_algo_attribution_ag` lève
 * « cannot extract elements from a scalar » sur TOUTES les collectes AG
 * (mesuré SQL 2026-10-02) ; une heure mal formée casse le cast `::time` de
 * la même façon. Les types sont ceux du CHECK de `parametres_algo.type_valeur`
 * (int, time, bool, decimal, string, text[]) ; un type non listé n'est pas
 * contraint.
 */
const VALIDATEURS: Record<
  string,
  { ok: (v: unknown) => boolean; attendu: string }
> = {
  bool: { ok: (v) => typeof v === 'boolean', attendu: 'booléen (true/false)' },
  int: {
    ok: (v) => typeof v === 'number' && Number.isInteger(v),
    attendu: 'nombre entier',
  },
  decimal: {
    ok: (v) => typeof v === 'number' && Number.isFinite(v),
    attendu: 'nombre décimal',
  },
  time: {
    ok: (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
    attendu: 'heure au format HH:MM',
  },
  string: { ok: (v) => typeof v === 'string', attendu: 'chaîne de caractères' },
  'text[]': {
    ok: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
    attendu: 'liste de chaînes, ex. ["75","92","93"]',
  },
};

export function valeurConformeAuType(
  type_valeur: string,
  valeur: unknown,
): { ok: true } | { ok: false; attendu: string } {
  const v = VALIDATEURS[type_valeur];
  if (!v || v.ok(valeur)) return { ok: true };
  return { ok: false, attendu: v.attendu };
}
