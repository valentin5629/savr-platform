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

/**
 * Part de l'enveloppe RÉSERVÉE au bloc Savr (contact de secours + informations
 * d'accès) — arbitrage Val 2026-09-15.
 *
 * Le défaut corrigé : le budget de l'agrégat et celui d'un SEUL de ses
 * composants étaient le même nombre. `collectes.informations_supplementaires`
 * peut légalement occuper 1000 caractères (§06.01 l.167 « Textarea, 1000 car.
 * max », repris par §08 E1 et appliqué à l'écriture par #322) ; l'agrégat étant
 * simplement concaténé derrière elle puis coupé par la fin, une note longue mais
 * parfaitement légitime évinçait tout le reste. Mesuré sur un lieu aux 6 champs
 * renseignés : dès 924 caractères la ligne « Accès » disparaissait, dès 962 la
 * ligne « Contact de secours » que #321 venait d'ajouter — et à 1000, le plafond
 * du CDC, le chauffeur ne recevait plus que la note.
 *
 * Le partage n'est pas figé à 50/50 : l'agrégat prend ce dont il a BESOIN, dans
 * la limite de ce plafond, et la note reçoit tout le reste. Un lieu peu bavard
 * (cas courant : ~250 caractères pour les 7 lignes) laisse donc ~750 caractères
 * à la note. Le plancher garanti de chaque côté est le même nombre : au pire
 * 500 pour l'agrégat, au pire 499 pour la note — aucun des deux ne peut faire
 * disparaître l'autre.
 */
const BUDGET_AGREGAT = 500;

/**
 * Sépare la saisie du traiteur du bloc composé par Savr.
 *
 * `informations_supplementaires` est légitimement multiligne (`<textarea>`, #322
 * l'autorise explicitement) : sans frontière, une note peut FORGER une ligne
 * « Contact de secours : 06 00 00 00 00 » indiscernable d'une vraie — et placée
 * AVANT elle, puisque la note ouvre le message (démontré en revue). Le
 * séparateur rend la frontière lisible pour le chauffeur sans amputer ni
 * réécrire la saisie : ce qui est au-dessus vient du traiteur, ce qui est en
 * dessous vient de la fiche (arbitrage Val 2026-09-15).
 *
 * Il n'est émis que lorsque les DEUX blocs sont présents : sans note, il n'y a
 * pas de frontière à marquer, et une ligne d'en-tête isolée serait du bruit.
 */
const SEPARATEUR_AGREGAT = '— Infos Savr —';

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

/**
 * Coupe à `max` unités UTF-16 SANS scinder une paire de surrogates.
 *
 * `slice` raisonne en unités de code : couper au milieu d'un emoji laisse un
 * demi-surrogate orphelin (40 cas atteignables mesurés en revue). C'est
 * exactement ce que la validation d'entrée de #322 refuse en amont — la sortie
 * ne doit pas le fabriquer en aval. Un demi-surrogate BAS en fin de coupe est
 * légitime : sa moitié haute est juste avant, la paire est entière ; seule une
 * moitié HAUTE finale signale une paire scindée, et c'est elle qu'on retire.
 */
function couper(valeur: string, max: number): string {
  if (max <= 0) return '';
  if (valeur.length <= max) return valeur;
  const coupe = valeur.slice(0, max);
  const derniere = coupe.charCodeAt(coupe.length - 1);
  return derniere >= 0xd800 && derniere <= 0xdbff ? coupe.slice(0, -1) : coupe;
}

// Borne du nom de secours. `evenements.contact_secours_nom` est un `text` dont
// l'écriture est bornée depuis #322 (route + CHECK), mais l'historique et tout
// chemin d'écriture hors route (RPC service_role, seed, script) restent non
// couverts : sans ce plafond, un nom démesuré évincerait à lui seul les
// informations d'accès qui le suivent dans le bloc Savr — y compris l'adresse
// corrigée de #304. 120 caractères couvrent très largement un nom de personne,
// et c'est exactement la borne d'entrée `BORNES_TEXTE_LIBRE.contact_secours_nom`
// (packages/plateforme/src/lib/champs-texte-libre.ts) : un nom accepté à la
// saisie n'est donc jamais tronqué ici.
const LIMITE_NOM_SECOURS = 120;

/**
 * Nom de contact rendu sûr pour une ligne du canal libre : blancs repliés (les
 * sauts de ligne d'abord — un nom multiligne forgerait sinon une fausse ligne
 * « Accès : … » lue comme telle par le chauffeur) puis longueur bornée.
 */
function nomContact(valeur: unknown): string {
  const brut = texte(valeur).replace(/\s+/g, ' ');
  if (brut.length <= LIMITE_NOM_SECOURS) return brut;
  return `${couper(brut, LIMITE_NOM_SECOURS - 1).trimEnd()}…`;
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
 * Lignes du bloc Savr, DANS L'ORDRE DE PRIORITÉ (= ordre de lecture, et ordre
 * inverse d'abandon si le bloc lui-même doit être tronqué) : contact de secours
 * > détails d'accès > stationnement > horaires > reste. Un champ vide n'émet
 * aucune ligne — jamais de « Stationnement : » orphelin.
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
 * Note du traiteur ramenée dans son budget, marqueur compris.
 *
 * C'est le contenu amputé EN PREMIER (arbitrage Val 2026-09-15) : c'est le seul
 * des deux blocs dont l'amputation ne rend inexploitable aucune donnée par
 * ailleurs transmise — le téléphone de secours part nativement en
 * `phoneAlternatives`, et les corrections d'accès saisies par collecte (#304)
 * n'ont pas d'autre chemin que ce message.
 */
function couperNote(note: string, budget: number): string {
  if (note.length <= budget) return note;
  const corps = couper(note, budget - MARQUEUR_TRONQUE.length - 1).trimEnd();
  return corps ? `${corps}\n${MARQUEUR_TRONQUE}` : MARQUEUR_TRONQUE;
}

/**
 * Bloc Savr ramené dans son budget : on abandonne les lignes ENTIÈRES par la
 * fin, `lignes` étant ordonné par priorité.
 *
 * Une ligne prioritaire trop longue à elle seule est servie AMPUTÉE plutôt
 * qu'escamotée : mieux vaut le début des détails d'accès que le seul marqueur.
 * L'en-tête ne compte pas comme une ligne de contenu — sinon un `acces_details`
 * démesuré produirait un séparateur suivi du seul marqueur, c'est-à-dire
 * l'escamotage que la règle précédente interdit.
 *
 * `budget` vaut toujours au moins `min(taille du bloc, BUDGET_AGREGAT)` : quand
 * la coupe est nécessaire il est donc ≥ 500, et `dispo` reste largement positif.
 */
function assemblerAgregat(
  entete: string,
  lignes: string[],
  budget: number,
): string {
  const complet = (entete ? [entete, ...lignes] : lignes).join('\n');
  if (complet.length <= budget) return complet;

  const prefixe = entete ? `${entete}\n` : '';
  const dispo = budget - prefixe.length - MARQUEUR_TRONQUE.length - 1; /* \n */

  const gardees: string[] = [];
  let taille = 0;
  for (const ligne of lignes) {
    const cout = (gardees.length > 0 ? 1 : 0) + ligne.length; /* \n + ligne */
    if (taille + cout > dispo) break;
    gardees.push(ligne);
    taille += cout;
  }

  const corps =
    gardees.length > 0 ? gardees.join('\n') : couper(lignes[0] ?? '', dispo);
  return corps
    ? `${prefixe}${corps}\n${MARQUEUR_TRONQUE}`
    : `${prefixe}${MARQUEUR_TRONQUE}`;
}

/**
 * Compose le champ libre transmis au transporteur : les informations
 * supplémentaires saisies par le traiteur, PUIS — sous un séparateur — le nom du
 * contact de secours et les informations d'accès du lieu (une par ligne).
 *
 * Les deux blocs se partagent l'enveloppe de {@link LIMITE_INFOS_SUPPLEMENTAIRES}
 * sans pouvoir s'évincer : le bloc Savr est servi le premier, dans la limite de
 * {@link BUDGET_AGREGAT}, et la note prend tout le reste. La note est donc le
 * contenu amputé en premier, et la coupe est signalée de chaque côté.
 *
 * @param lieu Lieu **FUSIONNÉ** (sortie de `applyLieuOverrides`), jamais le lieu
 *   officiel : les corrections saisies par collecte sont précisément ce qui doit
 *   atteindre le chauffeur (PROG-01/PROG-03, #304).
 * @param informationsSupplementaires Saisie du traiteur, placée en tête.
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

  // Un seul bloc : il dispose de toute l'enveloppe, et aucune frontière n'est à
  // marquer.
  if (lignes.length === 0) {
    return couperNote(base, LIMITE_INFOS_SUPPLEMENTAIRES);
  }
  if (!base) {
    return assemblerAgregat('', lignes, LIMITE_INFOS_SUPPLEMENTAIRES);
  }

  const tailleAgregat = [SEPARATEUR_AGREGAT, ...lignes].join('\n').length;
  const reserve = Math.min(tailleAgregat, BUDGET_AGREGAT);

  const note = couperNote(
    base,
    LIMITE_INFOS_SUPPLEMENTAIRES - reserve - 1 /* \n */,
  );
  const agregat = assemblerAgregat(
    SEPARATEUR_AGREGAT,
    lignes,
    LIMITE_INFOS_SUPPLEMENTAIRES - note.length - 1 /* \n */,
  );

  return `${note}\n${agregat}`;
}
