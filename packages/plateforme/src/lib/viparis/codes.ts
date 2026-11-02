// Codes VIPARIS (Val 2026-11-02) : code site du lieu, code affaire de l'événement.
// Même liste et même format que les CHECK de la migration 20261102150000 : une
// valeur refusée ici l'aurait été par la base, avec une erreur 500 au lieu d'un 422.

export const CODES_SITE_VIPARIS = [
  'PCP',
  'PCC',
  'CNIT2',
  'CDL',
  'CHAMP',
  'PDV',
  'PNV',
  'PLB',
] as const;

export type CodeSiteViparis = (typeof CODES_SITE_VIPARIS)[number];

export function estCodeSiteViparis(v: unknown): v is CodeSiteViparis {
  return (
    typeof v === 'string' &&
    (CODES_SITE_VIPARIS as readonly string[]).includes(v)
  );
}

export const MESSAGE_FORMAT_CODE_AFFAIRE_VIPARIS =
  'Le code affaire VIPARIS compte 7 lettres ou chiffres (ex. 26SIAL1).';

/**
 * Lit un code affaire VIPARIS saisi : espaces retirés, mis en majuscules.
 * Rend `null` pour une saisie vide, `undefined` pour un format invalide.
 */
export function normaliserCodeAffaireViparis(
  v: unknown,
): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return undefined;
  const code = v.trim().toUpperCase();
  if (code === '') return null;
  return /^[A-Z0-9]{7}$/.test(code) ? code : undefined;
}
