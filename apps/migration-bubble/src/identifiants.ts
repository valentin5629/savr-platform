/**
 * Identifiants cibles déterministes (04 - Transformations §1).
 *
 * Chaque ligne importée reçoit un UUID v5 calculé depuis son identifiant
 * Bubble : rejouer l'import sur un export plus récent retrouve les mêmes
 * lignes au lieu d'en créer de nouvelles.
 */
import { createHash } from 'node:crypto';

/** Espace de noms de la migration Bubble — figé, ne jamais le changer. */
export const ESPACE_MIGRATION = 'a3b1c5d7-0000-4000-8000-5a7600000001';

export type GenreCible =
  | 'entreprise'
  | 'agence'
  | 'organisation'
  | 'entite'
  | 'domaine'
  | 'utilisateur'
  | 'lieu'
  | 'association'
  | 'transporteur'
  | 'contact'
  | 'pack'
  | 'abonnement'
  | 'evenement'
  | 'collecte'
  | 'flux'
  | 'attribution';

export function identifiantCible(genre: GenreCible, cleSource: string): string {
  const espace = Buffer.from(ESPACE_MIGRATION.replace(/-/g, ''), 'hex');
  const h = createHash('sha1')
    .update(espace)
    .update(`${genre}:${cleSource}`, 'utf8')
    .digest();
  h[6] = (h[6]! & 0x0f) | 0x50; // version 5
  h[8] = (h[8]! & 0x3f) | 0x80; // variante RFC 4122
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
