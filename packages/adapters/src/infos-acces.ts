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

/** `flux_autorises` = `text[]` en base → liste lisible ; entrées non-chaînes écartées. */
function liste(valeur: unknown): string {
  if (!Array.isArray(valeur)) return '';
  return valeur
    .map((v) => texte(v))
    .filter(Boolean)
    .join(', ');
}

/**
 * Lignes d'accès, DANS L'ORDRE DE PRIORITÉ (= ordre de lecture, et ordre inverse
 * d'abandon en cas de troncature) : détails d'accès > stationnement > horaires >
 * reste. Un champ vide n'émet aucune ligne — jamais de « Stationnement : »
 * orphelin.
 */
function lignesAcces(lieu: Lieu): string[] {
  const candidates: Array<[string, string]> = [
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
 * supplémentaires saisies par le traiteur, PUIS les informations d'accès du lieu
 * (une par ligne).
 *
 * @param lieu Lieu **FUSIONNÉ** (sortie de `applyLieuOverrides`), jamais le lieu
 *   officiel : les corrections saisies par collecte sont précisément ce qui doit
 *   atteindre le chauffeur (PROG-01/PROG-03, #304).
 * @param informationsSupplementaires Saisie du traiteur. Elle est PRÉSERVÉE et
 *   placée en tête — l'agrégat s'y ajoute, il ne la remplace pas.
 * @returns Le champ libre, ou `null` si rien à transmettre (aucune ligne ne doit
 *   être créée pour une collecte sans information : `null` = pas de `comment`
 *   MTS-1, pas de `notes` Everest).
 */
export function composerInformationsSupplementaires(
  lieu: Lieu,
  informationsSupplementaires: string | null | undefined,
): string | null {
  const base = texte(informationsSupplementaires);
  const lignes = lignesAcces(lieu);

  if (!base && lignes.length === 0) return null;

  const retenues: string[] = [];
  // Budget consommé : la base, puis chaque ligne précédée de son saut de ligne.
  let taille = base.length;
  let tronque = false;

  for (const ligne of lignes) {
    const cout = ligne.length + (taille > 0 ? 1 : 0);
    if (taille + cout > LIMITE_INFOS_SUPPLEMENTAIRES) {
      // Ordre de priorité = ordre du tableau : on s'arrête, on ne va pas
      // repêcher une ligne moins prioritaire parce qu'elle serait plus courte.
      tronque = true;
      break;
    }
    retenues.push(ligne);
    taille += cout;
  }

  if (tronque) {
    // Faire de la place au marqueur, en abandonnant d'abord les lignes les
    // moins prioritaires.
    while (
      retenues.length > 0 &&
      taille + MARQUEUR_TRONQUE.length + 1 > LIMITE_INFOS_SUPPLEMENTAIRES
    ) {
      const retiree = retenues.pop()!;
      taille -= retiree.length + 1;
    }
    retenues.push(MARQUEUR_TRONQUE);
  }

  const blocs = base ? [base, ...retenues] : retenues;
  // Dernier rempart : la borne doit tenir même si la base dépasse déjà à elle
  // seule (colonne `text` sans CHECK en base).
  return blocs.join('\n').slice(0, LIMITE_INFOS_SUPPLEMENTAIRES);
}
