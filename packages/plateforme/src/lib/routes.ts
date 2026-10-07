/**
 * Chemins de pages — source unique (R-UI-2 J4).
 *
 * ⚠ Module PUR (aucun import serveur/client, seulement `./roles`, lui-même pur) :
 * importé par le middleware (Edge runtime).
 *
 * Une seule définition « rôle → espace » (`ESPACES`) dont dérivent les 4 tables
 * rôle ↔ chemin, autrefois écrites à la main : `HOME_BY_ROLE` (page racine),
 * `ROLE_PREFIXES` (middleware), les hrefs de `NAV_CONFIG` (navigation) et
 * `API_COLLECTES` (liste collectes traiteur/agence). Équivalence avec l'ancien
 * contenu littéral : `routes.test.ts`.
 *
 * Les chemins paramétrés n'encodent PAS l'identifiant (iso-comportement avec les
 * anciens gabarits ; ids = uuid). Les chemins d'API (`/api/…`) ne sont pas ici,
 * sauf la base fermée `apiCollectes` (cf. scripts/check-fetch-path-encoding.ts).
 */
import { ROLES_STAFF, type ClientRole, type Role } from './roles';

// ---------------------------------------------------------------------------
// Espaces : rôle → préfixe, accueil, API collectes
// ---------------------------------------------------------------------------

interface DefinitionEspace {
  /** Préfixe de route gardé par le middleware. */
  readonly prefixe: string;
  /** Page d'accueil du rôle (redirection de `/`). */
  readonly accueil: string;
  /** Rôles de l'espace (ordre = ordre de la liste du middleware). */
  readonly roles: readonly Role[];
  /** Base LITTÉRALE de l'API liste collectes (espaces traiteur/agence). */
  readonly apiCollectes?: string;
}

export const ESPACES = {
  admin: {
    prefixe: '/admin',
    accueil: '/admin/dashboard',
    roles: ROLES_STAFF,
  },
  traiteur: {
    prefixe: '/traiteur',
    accueil: '/traiteur',
    roles: ['traiteur_manager', 'traiteur_commercial'],
    apiCollectes: '/api/v1/traiteur/collectes',
  },
  agence: {
    prefixe: '/agence',
    accueil: '/agence',
    roles: ['agence'],
    apiCollectes: '/api/v1/agence/collectes',
  },
  gestionnaire: {
    prefixe: '/gestionnaire',
    accueil: '/gestionnaire',
    roles: ['gestionnaire_lieux'],
  },
  organisateur: {
    prefixe: '/organisateur',
    accueil: '/organisateur',
    roles: ['client_organisateur'],
  },
} as const satisfies Record<string, DefinitionEspace>;

export type Espace = keyof typeof ESPACES;

/** Rôles autorisés à programmer (formulaire + brouillons), staff en support. */
const ROLES_PROGRAMMATION = [
  'traiteur_commercial',
  'traiteur_manager',
  'agence',
  'gestionnaire_lieux',
  ...ROLES_STAFF,
] as const satisfies readonly Role[];

/** Registre ZD : tous les rôles clients sauf l'agence (§09 F6). */
const ROLES_REGISTRE = [
  'traiteur_manager',
  'traiteur_commercial',
  'gestionnaire_lieux',
  'client_organisateur',
] as const satisfies readonly ClientRole[];

/** Espace de chaque rôle (dérivé de `ESPACES`, exhaustif sur l'enum). */
export const ESPACE_PAR_ROLE = Object.fromEntries(
  (Object.keys(ESPACES) as Espace[]).flatMap((espace) =>
    ESPACES[espace].roles.map((role) => [role, espace]),
  ),
) as Record<Role, Espace>;

/** Page d'accueil par rôle (redirection de `/`). */
export const HOME_BY_ROLE: Record<Role, string> = Object.fromEntries(
  Object.entries(ESPACE_PAR_ROLE).map(([role, espace]) => [
    role,
    ESPACES[espace].accueil,
  ]),
) as Record<Role, string>;

// ---------------------------------------------------------------------------
// Chemins
// ---------------------------------------------------------------------------

const A = ESPACES.admin.prefixe;
const T = ESPACES.traiteur.prefixe;
const AG = ESPACES.agence.prefixe;
const G = ESPACES.gestionnaire.prefixe;
const O = ESPACES.organisateur.prefixe;
const PROG = '/programmer';
const REG = '/registre';

export const ROUTES = {
  racine: '/',
  login: '/login',
  signup: '/signup',
  verifyEmail: '/verify-email',
  resetPassword: '/reset-password',
  cgu: '/cgu',
  interdit: '/403',

  registre: REG,
  registreMethodologie: `${REG}/methodologie`,
  registreCollecte: (collecteId: string) => `${REG}/${collecteId}`,

  brouillons: '/brouillons',
  programmer: {
    racine: PROG,
    nouveau: `${PROG}/nouveau`,
    confirmation: `${PROG}/confirmation`,
    brouillon: (id: string) => `${PROG}/brouillon/${id}`,
    ajouterCollecte: (evenementId: string) =>
      `${PROG}/${evenementId}/ajouter-collecte`,
  },

  admin: {
    racine: A,
    dashboard: ESPACES.admin.accueil,
    dashboardClient: `${A}/dashboard-client`,
    collectes: `${A}/collectes`,
    collecte: (id: string) => `${A}/collectes/${id}`,
    factures: `${A}/factures`,
    facture: (id: string) => `${A}/factures/${id}`,
    associations: `${A}/associations`,
    transporteurs: `${A}/transporteurs`,
    lieux: `${A}/lieux`,
    clients: `${A}/clients`,
    client: (id: string) => `${A}/clients/${id}`,
    organisation: (id: string) => `${A}/organisations/${id}`,
    attributionAg: (collecteId: string) => `${A}/attributions-ag/${collecteId}`,
    monProfil: `${A}/mon-profil`,
    alertes: `${A}/alertes`,
    santeSysteme: `${A}/sante-systeme`,
    settingsUsers: `${A}/settings/users`,
    parametres: `${A}/parametres`,
    parametresGrillesZd: `${A}/parametres/grilles-zd`,
    parametresTarifsAg: `${A}/parametres/tarifs-ag`,
    parametresTauxRecyclage: `${A}/parametres/taux-recyclage`,
    parametresCo2: `${A}/parametres/co2`,
    parametresAlgoAg: `${A}/parametres/algo-ag`,
    parametresAutoAccept: `${A}/parametres/auto-accept`,
    parametresTemplates: `${A}/parametres/templates`,
  },

  traiteur: {
    racine: T,
    collectes: `${T}/collectes`,
    collecte: (id: string) => `${T}/collectes/${id}`,
    monOrganisation: `${T}/mon-organisation`,
    monProfil: `${T}/mon-profil`,
  },

  agence: {
    racine: AG,
    collectes: `${AG}/collectes`,
    collecte: (id: string) => `${AG}/collectes/${id}`,
    monOrganisation: `${AG}/mon-organisation`,
    monProfil: `${AG}/mon-profil`,
  },

  gestionnaire: {
    racine: G,
    lieux: `${G}/lieux`,
    lieu: (id: string) => `${G}/lieux/${id}`,
    collectes: `${G}/collectes`,
    collecte: (id: string) => `${G}/collectes/${id}`,
    traiteurs: `${G}/traiteurs`,
    traiteur: (id: string) => `${G}/traiteurs/${id}`,
    monPackAg: `${G}/mon-pack-ag`,
    monOrganisation: `${G}/mon-organisation`,
    parametres: `${G}/parametres`,
  },

  organisateur: {
    racine: O,
    collectes: `${O}/collectes`,
    documents: `${O}/documents`,
    monOrganisation: `${O}/mon-organisation`,
    monProfil: `${O}/mon-profil`,
  },
} as const;

// ---------------------------------------------------------------------------
// Tables dérivées
// ---------------------------------------------------------------------------

/**
 * Gating par préfixe du middleware (§09) : un préfixe par espace (rôles de
 * l'espace) + les sections transverses (registre, programmation, brouillons).
 */
export const ROLE_PREFIXES: Record<string, string[]> = {
  ...Object.fromEntries(
    Object.values(ESPACES).map((e) => [e.prefixe, [...e.roles]]),
  ),
  [ROUTES.registre]: [...ROLES_REGISTRE],
  [ROUTES.programmer.racine]: [...ROLES_PROGRAMMATION],
  [ROUTES.brouillons]: [...ROLES_PROGRAMMATION],
};

/** Bases LITTÉRALES de l'API liste collectes, par espace client. */
export const API_COLLECTES = {
  traiteur: ESPACES.traiteur.apiCollectes,
  agence: ESPACES.agence.apiCollectes,
} as const;
