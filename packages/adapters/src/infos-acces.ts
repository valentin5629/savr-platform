// Agrégation des informations d'accès du lieu dans le SEUL canal libre routé
// vers les transporteurs V1 — arbitrage Val 2026-09-15 (divergence M1.5
// « infos d'accès non transmises »).
//
// Les 6 champs d'accès que le formulaire de programmation offre à l'édition par
// collecte (`acces_details`, `stationnement`, `acces_office`,
// `contraintes_horaires`, `type_vehicule_max`, `flux_autorises`) n'ont AUCUNE
// contrepartie native dans les API MTS-1 et Everest — au même titre que
// `controle_acces_requis` (§08, hors payload sortant V1). Ce qui part réellement
// sur le fil est une ligne d'adresse (`addressSingleLine` / `pickup.address`) et
// un unique champ libre : `collectes.informations_supplementaires`, mappé sur
// `comment` (MTS-1) et `notes` (Everest). Sans l'agrégat ci-dessous, un
// « stationnement : cour intérieure, quai 3 » est saisi, stocké, affiché, audité
// — et le chauffeur arrive avec la seule adresse postale.
//
// Même mécanique pour le NOM DU CONTACT DE SECOURS (arbitrage Val 2026-09-14,
// relevé as-built MTS-1 l.79 + §08 l.393-397) : MTS-1 n'expose qu'UN contact par
// commande, son téléphone part donc en `phoneAlternatives` et son nom n'a nulle
// part où aller — « sans quoi le chauffeur a un numéro de secours sans savoir
// qui appeler ». Everest est plus pauvre encore : `pickup.contact` est un objet
// `{ name, phone }` unique, sans alternative — le nom passe par `notes` comme
// ici, et son téléphone reste sans canal (divergence M1.5_20260915bis).
//
// ⚠ Appelé par `fetchCollecte` (outbox-worker), donc UNE fois pour les deux
// adapters — jamais par un adapter. Garde-fou 2 (CLAUDE.md §3bis) : l'adapter V1
// et le TMS natif V2 doivent alimenter les mêmes champs avec la même sémantique ;
// une concaténation dupliquée par adapter garantirait le drift (déjà vécu sur
// `dirty_tms`, #196).

import type { Lieu } from './index.js';

// Borne du canal libre. Ni MTS-1 (`comment`) ni Everest (`notes`) ne documentent
// de longueur maximale ; la seule borne écrite est celle de la SOURCE, côté
// Plateforme : §08 E1 « `informations_supplementaires` (text nullable, max 1000
// car.) ». L'agrégat empruntant ce même champ, il respecte ce plafond plutôt que
// de partir en troncature silencieuse chez le tiers.
export const LIMITE_INFOS_SUPPLEMENTAIRES = 1000;

// Marqueur de troncature : le chauffeur doit pouvoir voir qu'il manque quelque
// chose (le reste est sur la fiche collecte), au lieu d'une coupe invisible.
const MARQUEUR_TRONQUE = '(…)';

// Libellés lisibles par un chauffeur. Les valeurs brutes des enums
// (`tres_difficile`, `velo_cargo`) ne sont pas destinées à être lues sur un
// téléphone à 22 h. Duplication assumée avec l'UI : `packages/adapters` ne peut
// pas importer `packages/plateforme`, et une valeur inconnue retombe sur la
// valeur brute plutôt que de faire disparaître l'information.
const LIBELLE_DIFFICULTE: Record<string, string> = {
  facile: 'facile',
  difficile: 'difficile',
  tres_difficile: 'très difficile',
};

const LIBELLE_VEHICULE: Record<string, string> = {
  velo_cargo: 'vélo cargo',
  camionnette: 'camionnette',
  fourgon: 'fourgon',
  vul: 'VUL',
  poids_lourd: 'poids lourd',
};

/**
 * Texte exploitable d'une valeur de lieu.
 *
 * `lieu_overrides` est un jsonb libre (pas de schéma, pas de CHECK) et sa
 * validation d'entrée côté routes est un lot distinct : à l'heure où ce code
 * tourne, une valeur surchargée peut être n'importe quel type JSON. Tout ce qui
 * n'est pas une chaîne est donc IGNORÉ — un objet interpolé donnerait
 * « Stationnement : [object Object] » au chauffeur.
 */
function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

function libelle(valeur: unknown, table: Record<string, string>): string {
  const brut = texte(valeur);
  if (!brut) return '';
  return table[brut] ?? brut;
}

// Borne du nom de secours. `evenements.contact_secours_nom` est un `text` SANS
// contrainte (ni CHECK en base, ni borne de longueur sur la route d'édition) :
// sans ce plafond, un nom démesuré évincerait à lui seul TOUTES les informations
// d'accès qui le suivent — y compris l'adresse corrigée de #304 — puisqu'il ouvre
// l'agrégat. 120 caractères couvrent très largement un nom de personne.
const LIMITE_NOM_SECOURS = 120;

/**
 * Nom de contact rendu sûr pour une ligne du canal libre : blancs repliés (les
 * sauts de ligne d'abord — un nom multiligne forgerait sinon une fausse ligne
 * « Accès : … » lue comme telle par le chauffeur) puis longueur bornée.
 */
function nomContact(valeur: unknown): string {
  const brut = texte(valeur).replace(/\s+/g, ' ');
  if (brut.length <= LIMITE_NOM_SECOURS) return brut;
  return `${brut.slice(0, LIMITE_NOM_SECOURS - 1).trimEnd()}…`;
}

/** `flux_autorises` = `text[]` en base → liste lisible ; entrées non-chaînes écartées. */
function liste(valeur: unknown): string {
  if (!Array.isArray(valeur)) return '';
  return valeur
    .map((v) => texte(v))
    .filter(Boolean)
    .join(', ');
}

/**
 * Lignes du canal libre, DANS L'ORDRE DE PRIORITÉ (= ordre de lecture, et ordre
 * inverse d'abandon en cas de troncature) : contact de secours > détails d'accès
 * > stationnement > horaires > reste. Un champ vide n'émet aucune ligne — jamais
 * de « Stationnement : » orphelin.
 *
 * Le contact de secours passe EN TÊTE : c'est la seule ligne dont l'absence rend
 * inexploitable une donnée par ailleurs transmise nativement (le téléphone de
 * secours, envoyé en `phoneAlternatives` par MTS-1). L'abandonner à la troncature
 * reproduirait exactement le défaut visé par l'arbitrage — « un numéro de secours
 * sans savoir qui appeler ». C'est aussi la plus courte : la placer en tête ne
 * coûte quasiment rien aux informations d'accès qui suivent.
 */
function lignesCanalLibre(
  lieu: Lieu,
  contactSecoursNom: string | null | undefined,
): string[] {
  const candidates: Array<[string, string]> = [
    ['Contact de secours', nomContact(contactSecoursNom)],
    ['Accès', texte(lieu.acces_details)],
    ['Stationnement', libelle(lieu.stationnement, LIBELLE_DIFFICULTE)],
    ['Contraintes horaires', texte(lieu.contraintes_horaires)],
    ['Accès office', libelle(lieu.acces_office, LIBELLE_DIFFICULTE)],
    ['Véhicule max', libelle(lieu.type_vehicule_max, LIBELLE_VEHICULE)],
    ['Flux acceptés', liste(lieu.flux_autorises)],
  ];
  return candidates
    .filter(([, valeur]) => valeur !== '')
    .map(([label, valeur]) => `${label} : ${valeur}`);
}

/**
 * Compose le champ libre transmis au transporteur : les informations
 * supplémentaires saisies par le traiteur, PUIS le nom du contact de secours et
 * les informations d'accès du lieu (une par ligne).
 *
 * @param lieu Lieu **FUSIONNÉ** (sortie de `applyLieuOverrides`), jamais le lieu
 *   officiel : les corrections saisies par collecte sont précisément ce qui doit
 *   atteindre le chauffeur (PROG-01/PROG-03, #304).
 * @param informationsSupplementaires Saisie du traiteur. Elle est PRÉSERVÉE et
 *   placée en tête — l'agrégat s'y ajoute, il ne la remplace pas.
 * @param contactSecoursNom `evenements.contact_secours_nom`. Paramètre
 *   **obligatoire** (quitte à passer `null`) : le défaut corrigé ici est
 *   précisément une donnée portée jusqu'au worker que personne ne lisait — un
 *   paramètre optionnel rouvrirait l'oubli silencieux au prochain appelant.
 * @returns Le champ libre, ou `null` si rien à transmettre (aucune ligne ne doit
 *   être créée pour une collecte sans information : `null` = pas de `comment`
 *   MTS-1, pas de `notes` Everest).
 */
export function composerInformationsSupplementaires(
  lieu: Lieu,
  informationsSupplementaires: string | null | undefined,
  contactSecoursNom: string | null | undefined,
): string | null {
  const base = texte(informationsSupplementaires);
  const lignes = lignesCanalLibre(lieu, contactSecoursNom);

  if (!base && lignes.length === 0) return null;

  const complet = [base, ...lignes].filter(Boolean).join('\n');
  if (complet.length <= LIMITE_INFOS_SUPPLEMENTAIRES) return complet;

  // Au-delà de la borne, on coupe par la FIN : `lignes` est ordonné par
  // priorité, donc couper la queue revient à abandonner le moins important.
  // Le budget réservé au marqueur garantit qu'il survit à la coupe — le cas que
  // le marqueur doit couvrir est précisément celui où la place manque.
  const budget =
    LIMITE_INFOS_SUPPLEMENTAIRES - MARQUEUR_TRONQUE.length - 1; /* \n */
  let coupe = complet.slice(0, budget);

  // Si la coupe tombe en plein milieu d'une ligne, on retire le fragment : un
  // « Stationnement : dif » orphelin est du bruit. SAUF s'il ne reste rien
  // d'autre — une ligne prioritaire trop longue à elle seule doit être servie
  // amputée plutôt qu'escamotée : mieux vaut le début des détails d'accès que
  // le seul marqueur.
  if (complet[coupe.length] !== '\n') {
    const dernierSaut = coupe.lastIndexOf('\n');
    if (dernierSaut > 0) coupe = coupe.slice(0, dernierSaut);
  }

  return `${coupe}\n${MARQUEUR_TRONQUE}`;
}
