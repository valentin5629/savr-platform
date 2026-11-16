/**
 * Seul fichier du paquet qui nomme les logiciels de transport : la valeur
 * « TmsType » de l'export Bubble et la valeur de l'enum `transporteurs.type_tms`
 * qui lui correspond (fiche de mapping 06). Ce sont des constantes de données,
 * pas un appel à un prestataire : aucun échange réseau ici ni ailleurs dans le
 * paquet. Fichier exempté dans `scripts/coupling-allowlist.txt` (garde-fou 3).
 */

export type TypeTms = 'mts1' | 'a_toutes' | 'autre';

/** Valeurs de la colonne Bubble « TmsType ». */
export const TMS_BUBBLE_CAMION = 'MTS-1';
export const TMS_BUBBLE_VELO = 'Everest';

export const TYPE_TMS_CAMION: TypeTms = 'mts1';
export const TYPE_TMS_VELO: TypeTms = 'a_toutes';

/** Type de logiciel d'un transporteur Bubble ; `deduit` = trouvé par le nom, à relire par l'Admin. */
export function typeTmsDepuisBubble(
  tmsType: string,
  nom: string,
): { type: TypeTms; deduit: boolean } {
  const t = tmsType.trim();
  if (t === TMS_BUBBLE_CAMION) return { type: TYPE_TMS_CAMION, deduit: false };
  if (t === TMS_BUBBLE_VELO) return { type: TYPE_TMS_VELO, deduit: false };
  if (/\ba\s+toutes?\b/i.test(nom))
    return { type: TYPE_TMS_VELO, deduit: true };
  return { type: 'autre', deduit: true };
}

/** Lignes de traçabilité des références des anciens logiciels, dans `collectes.notes_internes`. */
export function notesReferencesTransport(
  referenceCamion: string | null,
  referenceVelo: string | null,
): string[] {
  return [
    referenceCamion ? `MTS-1: ${referenceCamion}` : null,
    referenceVelo ? `Everest: ${referenceVelo}` : null,
  ].filter((l): l is string => l !== null);
}
