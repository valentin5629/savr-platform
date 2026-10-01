/**
 * Clients organisateurs de seed_demo — `evenements.nom_client_organisateur`.
 *
 * Pourquoi : tant que le seed ne posait pas ce champ, la colonne « Client » des
 * listes Collectes (traiteur, agence, gestionnaire) affichait « — » sur toutes
 * les lignes et le filtre « Client organisateur » n'avait aucune option — ni
 * l'une ni l'autre ne pouvait se tester ni se démontrer.
 *
 * Liste courte et réutilisée : un filtre n'a de sens que si un même client
 * revient sur plusieurs événements. Noms inventés pour le seed, dans l'esprit
 * de `@savr-test.local` et de `fakePhone`. Ils n'ont été confrontés à aucun
 * registre : en changer si l'un d'eux se révèle être celui d'une société réelle.
 *
 * Une part des événements reste sans client : la colonne est facultative en
 * base (création Admin, historique migré), et la liste doit continuer de montrer
 * son « — ».
 *
 * `client_organisateur_organisation_id` (rattachement à un compte client,
 * réservé Admin) n'est PAS posé ici : seul le nom libre l'est.
 */

import { createHash } from 'node:crypto';

export const CLIENTS_ORGANISATEURS_SEED = [
  'Groupe Zéphirane',
  'Banque Montclar',
  'Laboratoires Sénéor',
  'Fondation Avelune',
  'Cabinet Thévenin & Roche',
  'Maison Halbrenne',
  'Ormeval Énergies',
  'Institut Kervalen',
] as const;

/** Part des événements de seed_demo dont le client organisateur est renseigné. */
export const PART_CLIENT_RENSEIGNE = 0.7;

/**
 * Client organisateur d'un événement de seed_demo, ou `null` s'il n'est pas
 * renseigné.
 *
 * Tiré par hachage du slug, pas par `i % n` : le seed répartit déjà les
 * événements d'agence (`i % 9`) et les prestataires (`i % 2`) par modulo
 * d'index, et un modulo de plus se corrélerait avec eux — une agence qui ne
 * verrait qu'un seul client, toujours le même. Le hachage est stable d'un run à
 * l'autre et indépendant de l'ordre des lignes.
 */
export function clientOrganisateurSeed(slug: string): string | null {
  const h = createHash('sha1').update(slug, 'utf8').digest();
  if (h.readUInt16BE(0) / 0x10000 >= PART_CLIENT_RENSEIGNE) return null;
  return CLIENTS_ORGANISATEURS_SEED[h[2]! % CLIENTS_ORGANISATEURS_SEED.length]!;
}
