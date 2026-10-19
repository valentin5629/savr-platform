// Commentaire transmis au transporteur : le SEUL canal libre routé vers les
// transporteurs V1 (`comment` de la commande MTS-1 et de la mission Everest,
// où il suit la consigne d'A Toutes!).
//
// Format décidé par Val le 2026-10-15 (C60, C61, C62), à la place de l'agrégat
// « note du traiteur, puis — Infos Savr — » du 2026-09-15 :
//
//   Traiteur : …
//   Nombre de pax : …
//   Instructions d'accès :
//   - Accès : …                       (détails d'accès du lieu)
//   - Précisions du traiteur : …      (`collectes.informations_supplementaires`)
//   - Contraintes horaires : …
//   - Accès office : …
//   - Flux acceptés : …
//   - Véhicule souhaité : …
//   Contact : nom, téléphone
//   Contact de secours : nom, téléphone
//   Livraison :                       (AG : l'association)
//   - Instructions d'accès : …
//
// « Véhicule max » et « Stationnement » n'y figurent plus (Val, C60). Le point B
// n'a aucun commentaire propre dans l'API MTS-1 (`CustomerOrderPlaceInput` sans
// `comment`, lu dans la documentation le 2026-10-15) : ses instructions d'accès
// ferment donc ce commentaire, sous « Livraison » (C62). Son contact n'y figure
// pas (Val, 2026-10-16, C67) : il part en contact de livraison
// (`stuffs[].relatedContact` MTS-1, contact de dépôt Everest).
//
// Les informations d'accès n'ont aucun champ natif chez MTS-1 ni chez Everest
// (arbitrage Val 2026-09-15) ; le nom du contact de secours non plus (arbitrage
// Val 2026-09-14 : « sans quoi le chauffeur a un numéro de secours sans savoir
// qui appeler »).
//
// Chaque valeur tient sur UNE ligne (`valeurLigne` replie toute rupture de
// ligne), y compris la saisie du traiteur : aucune valeur ne peut donc forger
// une ligne « Contact : … » lue comme composée par Savr. C'est ce qui remplace
// le séparateur « — Infos Savr — » de l'ancien format, qui ne protégeait que les
// lignes placées sous lui.
//
// ⚠ Appelé par `fetchCollecte` (outbox-worker), donc UNE fois pour les deux
// adapters — jamais par un adapter. Garde-fou 2 (CLAUDE.md §3bis) : l'adapter V1
// et le TMS natif V2 doivent alimenter les mêmes champs avec la même sémantique ;
// une concaténation dupliquée par adapter garantirait le drift (déjà vécu sur
// `dirty_tms`, #196).

import type { Lieu } from './index.js';

// Borne du canal libre. Ni MTS-1 ni Everest (`comment` des deux) ne documentent
// de longueur maximale ; la seule borne écrite est celle de la SOURCE, côté
// Plateforme : §08 E1 « `informations_supplementaires` (text nullable, max 1000
// car.) ». Le commentaire empruntant ce même champ, il respecte ce plafond plutôt
// que de partir en troncature silencieuse chez le tiers.
export const LIMITE_INFOS_SUPPLEMENTAIRES = 1000;

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
 * `lieu_overrides` est un jsonb libre (pas de schéma, pas de CHECK) : une valeur
 * surchargée peut être n'importe quel type JSON. Tout ce qui n'est pas une
 * chaîne est donc IGNORÉ — un objet interpolé donnerait « Accès : [object
 * Object] » au chauffeur.
 */
function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/**
 * Valeur destinée à UNE ligne du canal libre : blancs repliés.
 *
 * Les colonnes de `plateforme.lieux` (`acces_details`, `contraintes_horaires`,
 * `flux_autorises`) n'ont AUCUNE validation d'entrée (route
 * `/api/v1/programmation/lieux`, aucun CHECK en base — vérifié en revue
 * sécurité), et `informations_supplementaires` est légitimement multiligne
 * (`<textarea>`, #322). Une valeur porteuse d'un `\n` forgerait donc une ligne
 * supplémentaire, lue par le chauffeur comme composée par Savr (relevé en revue
 * sécurité, reproduit). Replier ne perd que la mise en page de la saisie.
 *
 * La classe replie TOUT ce qui peut rompre une ligne, pas seulement `\s` : ce
 * dernier laisse passer NEL (U+0085) et les séparateurs U+001C-U+001F, qui sont
 * des ruptures de ligne obligatoires d'Unicode (UAX #14) et que `JSON.stringify`
 * n'échappe même pas au-delà de U+001F. `\p{Cc}` les couvre tous (C0 + DEL +
 * C1), `\p{Zl}`/`\p{Zp}` nomment explicitement U+2028/U+2029. Le drapeau `u` est
 * requis pour que les classes de propriété existent.
 *
 * Ce qui n'est PAS traité ici, faute de rapport avec le forgeage d'une ligne :
 * les overrides bidirectionnels (U+202E…) peuvent inverser le rendu À
 * L'INTÉRIEUR d'une ligne sans jamais en créer une seconde.
 */
function valeurLigne(valeur: unknown): string {
  return texte(valeur).replace(/[\s\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ');
}

function libelle(valeur: unknown, table: Record<string, string>): string {
  const brut = valeurLigne(valeur);
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

/**
 * Valeur d'une ligne, repliée puis bornée à `max` caractères. Une valeur coupée
 * porte « … » collé à son dernier mot : « appeler le gardien au 06 12 3 » sans
 * marque se lirait comme un numéro complet (relevé en revue sécurité).
 */
export function uneLigne(valeur: unknown, max: number): string {
  const brut = valeurLigne(valeur);
  if (brut.length <= max) return brut;
  return `${couper(brut, max - 1).trimEnd()}…`;
}

// Borne d'un nom (contact, traiteur). Les noms de contact sont bornés à
// l'écriture depuis #322, mais l'historique et tout chemin d'écriture hors route
// (RPC service_role, seed, script) restent non couverts. 120 caractères, c'est
// exactement la borne d'entrée `BORNES_TEXTE_LIBRE.contact_secours_nom`
// (packages/plateforme/src/lib/champs-texte-libre.ts) : un nom accepté à la
// saisie n'est donc jamais tronqué ici.
const LIMITE_NOM_SECOURS = 120;

// Borne d'un numéro au format libre, même valeur que la borne d'entrée des
// téléphones de contact (champs-texte-libre-bornes.ts).
const LIMITE_TELEPHONE = 40;

/** `flux_autorises` = `text[]` en base → liste lisible ; entrées non-chaînes écartées. */
function liste(valeur: unknown): string {
  if (!Array.isArray(valeur)) return '';
  return valeur
    .map((v) => valeurLigne(v))
    .filter(Boolean)
    .join(', ');
}

/** Besoin véhicule saisi à l'attribution AG (décision Val 2026-10-01). */
export interface VehiculeSouhaite {
  /** Valeur de l'enum plateforme.type_vehicule, ou null si non précisé. */
  readonly type: string | null | undefined;
  /** `collectes.nb_camions_demande` = nombre de commandes identiques. */
  readonly nombre: number;
}

/**
 * Véhicule demandé par l'Admin à l'attribution (décision Val 2026-10-01). Le
 * texte est composé UNE fois puis envoyé à l'identique sur les N commandes
 * (N véhicules = N commandes identiques) : il dit donc « 1 par commande » pour
 * qu'un prestataire ne lise pas « 2 × camionnette » comme 2 véhicules PAR
 * commande. Formes :
 *   - N = 1, type connu  → « camionnette »
 *   - N > 1, type connu  → « camionnette (1 par commande, 2 commandes identiques pour cette collecte) »
 *   - N > 1, sans type   → « 1 par commande, 3 commandes identiques pour cette collecte »
 *   - N = 1, sans type   → rien à dire.
 */
function ligneVehicule(vehicule: VehiculeSouhaite | null): string {
  if (!vehicule) return '';
  const type = libelle(vehicule.type, LIBELLE_VEHICULE);
  const nombre = Number.isInteger(vehicule.nombre) ? vehicule.nombre : 1;
  if (nombre <= 1) return type;
  const repartition = `1 par commande, ${nombre} commandes identiques pour cette collecte`;
  return type ? `${type} (${repartition})` : repartition;
}

/** « nom, téléphone », ou celui des deux qui existe. */
function ligneContact(nom: unknown, telephone: unknown): string {
  return [
    uneLigne(nom, LIMITE_NOM_SECOURS),
    uneLigne(telephone, LIMITE_TELEPHONE),
  ]
    .filter(Boolean)
    .join(', ');
}

/** Contact d'une ligne du commentaire. */
export interface ContactCommentaire {
  readonly nom: string | null | undefined;
  readonly telephone: string | null | undefined;
}

/** Ce que le commentaire au transporteur rassemble. */
export interface EntreeCommentaire {
  /** Nom de l'organisation traiteur opérationnelle de l'événement. */
  readonly traiteurNom: string | null | undefined;
  /** `evenements.pax`. */
  readonly pax: number | null | undefined;
  /**
   * Lieu **FUSIONNÉ** (sortie de `applyLieuOverrides`), jamais le lieu officiel :
   * les corrections saisies par collecte sont précisément ce qui doit atteindre
   * le chauffeur (PROG-01/PROG-03, #304).
   */
  readonly lieu: Lieu;
  /** Saisie du traiteur (`collectes.informations_supplementaires`). */
  readonly informationsSupplementaires: string | null | undefined;
  readonly contact: ContactCommentaire;
  readonly contactSecours: ContactCommentaire;
  /** Besoin véhicule de l'attribution AG, `null` en ZD. */
  readonly vehicule: VehiculeSouhaite | null;
  /** Point B d'une collecte AG (l'association), `null` sinon. */
  readonly livraison: {
    readonly instructionsAcces: string | null | undefined;
  } | null;
}

// Plafonds par ligne longue, avant l'ajustement à l'enveloppe : aucune de ces
// valeurs n'est bornée à la saisie (lieux, associations) ou elles le sont à 1000
// (saisie du traiteur), soit à elles seules toute l'enveloppe.
const LIMITE_LIGNE_LONGUE = 600;

/**
 * Longueur en deçà de laquelle un fragment de ligne amputée ne vaut pas d'être
 * servi : ce qui survit ne dépasserait guère son libellé, et le chauffeur lirait
 * du bruit. Une ligne qui ne tient pas au-dessus de ce seuil est retirée.
 */
const MIN_FRAGMENT_LIGNE = 40;

interface Puce {
  readonly libelle: string;
  valeur: string;
  /**
   * Rang d'abandon quand l'enveloppe déborde (1 = amputé en premier) ; absent =
   * jamais amputé. La saisie du traiteur part la première, comme dans
   * l'arbitrage du 2026-09-15 : elle ne porte aucune donnée sans autre chemin.
   */
  readonly abandon?: number;
}

interface Bloc {
  /** « Libellé : valeur » sur une ligne, ou en-tête de liste à puces. */
  readonly libelle: string;
  readonly valeur?: string;
  readonly puces?: Puce[];
}

function rendre(blocs: Bloc[]): string {
  const lignes: string[] = [];
  for (const b of blocs) {
    if (b.puces) {
      const puces = b.puces.filter((p) => p.valeur !== '');
      if (puces.length === 0) continue;
      lignes.push(`${b.libelle} :`);
      for (const p of puces) lignes.push(`- ${p.libelle} : ${p.valeur}`);
    } else if (b.valeur) {
      lignes.push(`${b.libelle} : ${b.valeur}`);
    }
  }
  return lignes.join('\n');
}

/**
 * Ramène le commentaire dans {@link LIMITE_INFOS_SUPPLEMENTAIRES}, en prenant
 * les lignes longues dans leur ordre d'abandon : chacune est amputée juste ce
 * qu'il faut si elle garde au moins {@link MIN_FRAGMENT_LIGNE} caractères, sinon
 * retirée, et l'on passe à la suivante. Les autres lignes (traiteur, pax,
 * contacts, véhicule, accès office) sont bornées par construction : ensemble,
 * elles font au plus ~670 caractères, et tiennent donc dans l'enveloppe une
 * fois les lignes longues retirées.
 */
function ajuster(blocs: Bloc[]): void {
  const longues = blocs
    .flatMap((b) => b.puces ?? [])
    .filter((p): p is Puce & { abandon: number } => p.abandon !== undefined)
    .sort((a, b) => a.abandon - b.abandon);

  for (const p of longues) {
    const exces = rendre(blocs).length - LIMITE_INFOS_SUPPLEMENTAIRES;
    if (exces <= 0) return;
    if (p.valeur === '') continue;
    const garde = p.valeur.length - exces - 1; /* « … » */
    if (garde >= MIN_FRAGMENT_LIGNE) {
      p.valeur = `${couper(p.valeur, garde).trimEnd()}…`;
      return;
    }
    p.valeur = '';
  }
}

/**
 * Compose le commentaire transmis au transporteur (format en tête de fichier).
 *
 * @returns Le commentaire, ou `null` si rien à transmettre (`null` = pas de
 *   `comment` MTS-1 ; côté Everest, la seule consigne d'A Toutes!).
 */
export function composerCommentaireTransporteur(
  e: EntreeCommentaire,
): string | null {
  const pax =
    typeof e.pax === 'number' && Number.isInteger(e.pax) && e.pax > 0
      ? String(e.pax)
      : '';
  const blocs: Bloc[] = [
    {
      libelle: 'Traiteur',
      valeur: uneLigne(e.traiteurNom, LIMITE_NOM_SECOURS),
    },
    { libelle: 'Nombre de pax', valeur: pax },
    {
      libelle: "Instructions d'accès",
      puces: [
        {
          libelle: 'Accès',
          valeur: uneLigne(e.lieu.acces_details, LIMITE_LIGNE_LONGUE),
          abandon: 2,
        },
        {
          libelle: 'Précisions du traiteur',
          valeur: uneLigne(e.informationsSupplementaires, LIMITE_LIGNE_LONGUE),
          abandon: 1,
        },
        {
          libelle: 'Contraintes horaires',
          valeur: uneLigne(e.lieu.contraintes_horaires, LIMITE_LIGNE_LONGUE),
          abandon: 4,
        },
        {
          libelle: 'Accès office',
          valeur: libelle(e.lieu.acces_office, LIBELLE_DIFFICULTE),
        },
        {
          libelle: 'Flux acceptés',
          valeur: uneLigne(liste(e.lieu.flux_autorises), LIMITE_LIGNE_LONGUE),
          abandon: 5,
        },
        { libelle: 'Véhicule souhaité', valeur: ligneVehicule(e.vehicule) },
      ],
    },
    {
      libelle: 'Contact',
      valeur: ligneContact(e.contact.nom, e.contact.telephone),
    },
    {
      libelle: 'Contact de secours',
      valeur: ligneContact(e.contactSecours.nom, e.contactSecours.telephone),
    },
    {
      libelle: 'Livraison',
      puces: e.livraison
        ? [
            {
              libelle: "Instructions d'accès",
              valeur: uneLigne(
                e.livraison.instructionsAcces,
                LIMITE_LIGNE_LONGUE,
              ),
              abandon: 3,
            },
          ]
        : [],
    },
  ];

  ajuster(blocs);
  const commentaire = rendre(blocs);
  return commentaire === '' ? null : commentaire;
}
