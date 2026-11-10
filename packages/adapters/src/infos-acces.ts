// Commentaires transmis au transporteur : le SEUL canal libre routé vers les
// transporteurs V1. Format décidé par Val le 2026-11-03, à la place du
// commentaire unique du 2026-10-15 (C60-C62) :
//
//   Commentaire de la mission :
//     Veuillez peser et prendre de belles photos de ce que vous récupérez svp
//     Véhicule souhaité : camion 20 m³ simple  (un seul véhicule, type précisé, Val 2026-11-10)
//     2 vélos prévus pour cette collecte, veuillez vous coordonner pour les
//     appels au traiteur                (seulement s'il y a plusieurs véhicules)
//
//   Adresse de départ (le lieu) :
//     - Instructions d'accès : …        (détails d'accès du lieu, surcharges comprises)
//     - Précisions du traiteur : …      (`collectes.informations_supplementaires`, Val 2026-11-03)
//     - Contact 1 : nom, téléphone
//     - Contact 2 : nom, téléphone      (contact de secours)
//     En cas d'urgence, appeler le 0761912997
//
//   Adresse d'arrivée (AG : l'association) :
//     - Instructions d'accès : …
//     - Contact : nom, téléphone
//
// Everest a un commentaire par adresse (`address_start_comment`,
// `address_end_comment`, swagger 1.294.1 lu le 2026-11-03) : chaque texte part
// dans son champ. MTS-1 n'a qu'un `comment` sur la commande
// (`CustomerOrderPlaceInput` sans commentaire) : il reçoit les trois textes
// réunis, sous « Départ : » et « Arrivée : » (texte `unique`).
//
// Ne partent plus (Val, 2026-11-03) : traiteur, nombre de pax, contraintes
// horaires, accès office, flux acceptés. Le véhicule souhaité d'une collecte à
// un seul véhicule repart depuis le 2026-11-10 (Val), en ZD comme en AG.
//
// Chaque valeur tient sur UNE ligne (`valeurLigne` replie toute rupture de
// ligne) : aucune saisie ne peut donc forger une ligne lue comme composée par
// Savr (« Contact 1 : … », « En cas d'urgence … »).
//
// ⚠ Appelé par le worker (`toCollecte`), donc UNE fois pour les deux adapters —
// jamais par un adapter. Garde-fou 2 (CLAUDE.md §3bis) : l'adapter V1 et le TMS
// natif V2 doivent alimenter les mêmes champs avec la même sémantique ; une
// composition dupliquée par adapter garantirait le drift (déjà vécu sur
// `dirty_tms`, #196).

import type { Lieu } from './index.js';

// Borne de chaque texte. Ni MTS-1 ni Everest ne documentent de longueur
// maximale ; la seule borne écrite est celle de la SOURCE, côté Plateforme :
// §08 E1 « `informations_supplementaires` (text nullable, max 1000 car.) ». Les
// commentaires empruntant ce canal, ils respectent ce plafond plutôt que de
// partir en troncature silencieuse chez le tiers.
export const LIMITE_INFOS_SUPPLEMENTAIRES = 1000;

/** Consigne de la mission (Val, 2026-11-03), seule ou presque. */
export const CONSIGNE_PESEE_PHOTOS =
  'Veuillez peser et prendre de belles photos de ce que vous récupérez svp';

/** Numéro d'urgence Savr, à l'adresse de départ (Val, 2026-11-03). */
export const NUMERO_URGENCE_SAVR = '0761912997';

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
 * Les colonnes de `plateforme.lieux` (`acces_details`) et des associations
 * n'ont AUCUNE validation d'entrée (aucun CHECK en base — vérifié en revue
 * sécurité). Une valeur porteuse d'un `\n` forgerait donc une ligne
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

// Borne d'un nom de contact : exactement la borne d'entrée
// `BORNES_TEXTE_LIBRE.contact_secours_nom` (packages/plateforme/src/lib/
// champs-texte-libre.ts) ; un nom accepté à la saisie n'est donc jamais tronqué
// ici. L'historique et tout chemin d'écriture hors route restent couverts.
const LIMITE_NOM = 120;

// Borne d'un numéro au format libre, même valeur que la borne d'entrée des
// téléphones de contact (champs-texte-libre-bornes.ts).
const LIMITE_TELEPHONE = 40;

// Borne d'une instruction d'accès (lieu, association), avant l'ajustement à
// l'enveloppe : aucune n'est bornée à la saisie.
const LIMITE_LIGNE_LONGUE = 600;

// Borne d'un type de véhicule repris tel quel (hors de la table des pluriels).
const LIMITE_TYPE_VEHICULE = 40;

/**
 * Longueur en deçà de laquelle un fragment de ligne amputée ne vaut pas d'être
 * servi : ce qui survit ne dépasserait guère son libellé, et le chauffeur lirait
 * du bruit. Une ligne qui ne tient pas au-dessus de ce seuil est retirée.
 */
const MIN_FRAGMENT_LIGNE = 40;

/** Besoin véhicule saisi par l'Admin avant l'envoi, AG et ZD (Val 2026-10-01, 2026-11-10). */
export interface VehiculeSouhaite {
  /** Valeur de l'enum plateforme.type_vehicule, ou null si non précisé. */
  readonly type: string | null | undefined;
  /** `collectes.nb_camions_demande` = nombre de véhicules (1 commande chacun). */
  readonly nombre: number;
  /**
   * `transporteurs.type_tms` du prestataire : nomme les véhicules quand l'Admin
   * n'a pas précisé de type (« vélos » chez A Toute!, « camions » chez MTS-1).
   */
  readonly typeTms?: string | null | undefined;
}

// Noms des véhicules : seul (« Véhicule souhaité : … ») et au pluriel avec
// accord (« N … prévu(e)s pour cette collecte »).
const NOMS_VEHICULE: Record<
  string,
  { seul: string; pluriel: string; feminin: boolean }
> = {
  velo_cargo: { seul: 'vélo cargo', pluriel: 'vélos cargo', feminin: false },
  camionnette: { seul: 'camionnette', pluriel: 'camionnettes', feminin: true },
  fourgon: { seul: 'fourgon', pluriel: 'fourgons', feminin: false },
  vul: { seul: 'VUL', pluriel: 'VUL', feminin: false },
  poids_lourd: { seul: 'poids lourd', pluriel: 'poids lourds', feminin: false },
  camionnette_frigo: {
    seul: 'camionnette frigo',
    pluriel: 'camionnettes frigo',
    feminin: true,
  },
  camion_frigo: {
    seul: 'camion frigo',
    pluriel: 'camions frigo',
    feminin: false,
  },
  camion_16m3_simple: {
    seul: 'camion 16 m³ simple',
    pluriel: 'camions 16 m³ simple',
    feminin: false,
  },
  camion_16m3_double: {
    seul: 'camion 16 m³ double',
    pluriel: 'camions 16 m³ double',
    feminin: false,
  },
  camion_20m3_simple: {
    seul: 'camion 20 m³ simple',
    pluriel: 'camions 20 m³ simple',
    feminin: false,
  },
  camion_20m3_double: {
    seul: 'camion 20 m³ double',
    pluriel: 'camions 20 m³ double',
    feminin: false,
  },
};

// Sans type précisé par l'Admin : le véhicule habituel du prestataire.
const PLURIEL_PAR_PRESTATAIRE: Record<string, string> = {
  a_toutes: 'vélos',
  mts1: 'camions',
};

/**
 * Phrase des véhicules, composée UNE fois puis envoyée à l'identique sur chaque
 * commande. Plusieurs véhicules (Val 2026-11-03) : « 2 vélos prévus pour cette
 * collecte, veuillez vous coordonner pour les appels au traiteur ». Un seul
 * véhicule au type précisé (Val 2026-11-10) : « Véhicule souhaité : camion
 * 20 m³ simple » ; sans type, rien.
 */
function phraseVehicules(vehicule: VehiculeSouhaite | null): string {
  if (!vehicule) return '';
  const nombre = Number.isInteger(vehicule.nombre) ? vehicule.nombre : 1;
  const type = uneLigne(vehicule.type, LIMITE_TYPE_VEHICULE);
  if (nombre <= 1) {
    const nomSeul = NOMS_VEHICULE[type]?.seul || type;
    return nomSeul ? `Véhicule souhaité : ${nomSeul}` : '';
  }
  const connu = NOMS_VEHICULE[type];
  const nom =
    connu?.pluriel ||
    type ||
    PLURIEL_PAR_PRESTATAIRE[valeurLigne(vehicule.typeTms)] ||
    'véhicules';
  const prevus = connu?.feminin ? 'prévues' : 'prévus';
  return `${nombre} ${nom} ${prevus} pour cette collecte, veuillez vous coordonner pour les appels au traiteur`;
}

/** « nom, téléphone », ou celui des deux qui existe. */
function ligneContact(contact: ContactCommentaire | null | undefined): string {
  if (!contact) return '';
  return [
    uneLigne(contact.nom, LIMITE_NOM),
    uneLigne(contact.telephone, LIMITE_TELEPHONE),
  ]
    .filter(Boolean)
    .join(', ');
}

/** Contact d'une ligne du commentaire. */
export interface ContactCommentaire {
  readonly nom: string | null | undefined;
  readonly telephone: string | null | undefined;
}

/** Ce que les commentaires au transporteur rassemblent. */
export interface EntreeCommentaire {
  /**
   * Lieu **FUSIONNÉ** (sortie de `applyLieuOverrides`), jamais le lieu officiel :
   * les corrections saisies par collecte sont précisément ce qui doit atteindre
   * le chauffeur (PROG-01/PROG-03, #304).
   */
  readonly lieu: Lieu;
  /** Saisie du traiteur (`collectes.informations_supplementaires`). */
  readonly informationsSupplementaires: string | null | undefined;
  /** Contact 1 de l'adresse de départ. */
  readonly contact: ContactCommentaire;
  /** Contact 2 de l'adresse de départ (contact de secours). */
  readonly contactSecours: ContactCommentaire;
  /** Besoin véhicule saisi par l'Admin (AG et ZD). */
  readonly vehicule: VehiculeSouhaite | null;
  /** Adresse d'arrivée d'une collecte AG (l'association), `null` sinon. */
  readonly livraison: {
    readonly instructionsAcces: string | null | undefined;
    readonly contact: ContactCommentaire | null;
  } | null;
}

/** Les textes composés. */
export interface CommentairesTransporteur {
  /** Commentaire de la mission : consigne, puis véhicule(s) souhaité(s). */
  readonly general: string;
  /** Commentaire de l'adresse de départ (jamais vide : numéro d'urgence). */
  readonly depart: string;
  /** Commentaire de l'adresse d'arrivée, `null` sans rien à dire. */
  readonly arrivee: string | null;
  /** Les trois réunis, pour un transporteur sans commentaire par adresse (MTS-1). */
  readonly unique: string;
}

interface Ligne {
  /** « - Libellé : » devant la valeur ; absent = la valeur seule. */
  readonly libelle?: string;
  valeur: string;
  /**
   * Rang d'abandon quand l'enveloppe déborde (1 = amputé en premier) ; absent =
   * jamais amputé (borné par construction).
   */
  readonly abandon?: number;
}

interface Bloc {
  /** En-tête « Départ : », seulement dans le texte unique. */
  readonly entete?: string;
  readonly lignes: Ligne[];
}

function rendre(blocs: Bloc[]): string {
  const sortie: string[] = [];
  for (const b of blocs) {
    const lignes = b.lignes.filter((l) => l.valeur !== '');
    if (lignes.length === 0) continue;
    if (b.entete) sortie.push(`${b.entete} :`);
    for (const l of lignes) {
      sortie.push(l.libelle ? `- ${l.libelle} : ${l.valeur}` : l.valeur);
    }
  }
  return sortie.join('\n');
}

/**
 * Ramène un texte dans {@link LIMITE_INFOS_SUPPLEMENTAIRES}, en prenant les
 * lignes longues dans leur ordre d'abandon : chacune est amputée juste ce qu'il
 * faut si elle garde au moins {@link MIN_FRAGMENT_LIGNE} caractères, sinon
 * retirée, et l'on passe à la suivante. Les autres lignes (consigne, véhicules,
 * contacts, urgence) sont bornées par construction : ensemble, elles font au plus
 * ~750 caractères, et tiennent donc dans l'enveloppe une fois les lignes longues
 * retirées.
 */
function ajuster(blocs: Bloc[]): void {
  const longues = blocs
    .flatMap((b) => b.lignes)
    .filter((l): l is Ligne & { abandon: number } => l.abandon !== undefined)
    .sort((a, b) => a.abandon - b.abandon);

  for (const l of longues) {
    const exces = rendre(blocs).length - LIMITE_INFOS_SUPPLEMENTAIRES;
    if (exces <= 0) return;
    if (l.valeur === '') continue;
    const garde = l.valeur.length - exces - 1; /* « … » */
    if (garde >= MIN_FRAGMENT_LIGNE) {
      l.valeur = `${couper(l.valeur, garde).trimEnd()}…`;
      return;
    }
    l.valeur = '';
  }
}

/** Copie profonde : chaque texte s'ajuste sans toucher aux autres. */
function copie(blocs: Bloc[]): Bloc[] {
  return blocs.map((b) => ({ ...b, lignes: b.lignes.map((l) => ({ ...l })) }));
}

function composer(blocs: Bloc[]): string {
  const travail = copie(blocs);
  ajuster(travail);
  return rendre(travail);
}

/**
 * Compose les commentaires transmis au transporteur (format en tête de fichier).
 */
export function composerCommentairesTransporteur(
  e: EntreeCommentaire,
): CommentairesTransporteur {
  const general: Bloc = {
    lignes: [
      { valeur: CONSIGNE_PESEE_PHOTOS },
      { valeur: phraseVehicules(e.vehicule) },
    ],
  };
  const depart: Bloc = {
    entete: 'Départ',
    lignes: [
      {
        libelle: "Instructions d'accès",
        valeur: uneLigne(e.lieu.acces_details, LIMITE_LIGNE_LONGUE),
        abandon: 3,
      },
      {
        libelle: 'Précisions du traiteur',
        valeur: uneLigne(e.informationsSupplementaires, LIMITE_LIGNE_LONGUE),
        abandon: 1,
      },
      { libelle: 'Contact 1', valeur: ligneContact(e.contact) },
      { libelle: 'Contact 2', valeur: ligneContact(e.contactSecours) },
      { valeur: `En cas d'urgence, appeler le ${NUMERO_URGENCE_SAVR}` },
    ],
  };
  const arrivee: Bloc = {
    entete: 'Arrivée',
    lignes: e.livraison
      ? [
          {
            libelle: "Instructions d'accès",
            valeur: uneLigne(
              e.livraison.instructionsAcces,
              LIMITE_LIGNE_LONGUE,
            ),
            abandon: 2,
          },
          { libelle: 'Contact', valeur: ligneContact(e.livraison.contact) },
        ]
      : [],
  };

  const sansEntete = (b: Bloc): Bloc => ({ lignes: b.lignes });
  const texteArrivee = composer([sansEntete(arrivee)]);
  return {
    general: composer([general]),
    depart: composer([sansEntete(depart)]),
    arrivee: texteArrivee === '' ? null : texteArrivee,
    unique: composer([general, depart, arrivee]),
  };
}
