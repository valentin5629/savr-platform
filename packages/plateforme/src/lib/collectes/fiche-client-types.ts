// Fiche collecte des rôles CLIENTS (traiteur, agence, gestionnaire de lieux) —
// pop-up commun, §06.04 « Fiche collecte (vue détail) », refonte Val 2026-09-29.
// Types de la réponse des routes GET /api/v1/{espace}/collectes/[id] et règles
// PURES partagées par le serveur (qui les applique) et l'écran (qui les lit).
// Aucune dépendance serveur ici : ce module est importé par un composant client.

export type EspaceClient = 'traiteur' | 'agence' | 'gestionnaire';

// Camions : chauffeur, plaque et téléphone visibles tant que la collecte n'est
// pas terminée (bloc « Logistique », §06.04). Hors de cette fenêtre la route ne
// renvoie AUCUN camion — le téléphone du chauffeur n'a plus de raison d'être lu.
export const STATUTS_LOGISTIQUE = ['programmee', 'validee', 'en_cours'];

// Association bénéficiaire AG affichée « dès la validation ».
export const STATUTS_ASSOCIATION = [
  'validee',
  'en_cours',
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
];

// Bilan affiché quand la collecte est « Réalisée » côté client (= `cloturee`,
// mapping canonique §06.04) ; `realisee_sans_collecte` a son propre bloc.
export const STATUT_BILAN = 'cloturee';

export const STATUTS_ANNULES = ['annulee', 'annulation_demandee'];

// Code de l'alerte in-app Ops « coordonnées du chauffeur en urgence » (une seule
// OUVERTE par collecte : index uniq_alerte_coordonnees_urgence_ouverte).
export const CODE_ALERTE_COORDONNEES_URGENCE = 'coordonnees_chauffeur_urgence';

// Traiteur opérationnel d'une collecte AG programmée par une AUTRE organisation
// (agence) : l'attestation de don est émise au nom du donneur d'ordre et
// att_traiteur_select ne la lui sert pas — la route de téléchargement répond
// 404 (D12, arbitrage Val 2026-09-30). Règle UNIQUE de la fiche et de la liste
// traiteur. Le rapport RSE (ZD, AG sans excédent) reste servi (rr_select).
export function rapportReserveDonneurOrdre(
  collecte: { type: string; statut: string },
  organisationProgrammatriceId: string | null | undefined,
  organisationUtilisateurId: string,
): boolean {
  return (
    collecte.type === 'anti_gaspi' &&
    collecte.statut !== 'realisee_sans_collecte' &&
    organisationProgrammatriceId != null &&
    organisationProgrammatriceId !== organisationUtilisateurId
  );
}

// Mention affichée à la place du téléchargement quand le rapport est réservé
// (fiche et liste traiteur).
export const LIBELLE_RAPPORT_RESERVE =
  'Réservé à l’organisation qui a programmé la collecte';

export interface TourneeFiche {
  chauffeur_nom: string | null;
  plaque_immatriculation: string | null;
  chauffeur_telephone: string | null;
  type_vehicule: string | null;
}

export interface LieuFiche {
  id: string;
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
  // Détails d'accès EFFECTIFS (référence du lieu + surcharge de la collecte).
  acces_details: string | null;
}

export interface EvenementFiche {
  id: string;
  nom_evenement: string | null;
  pax: number | null;
  type_evenement_id: string | null;
  type_evenement: { libelle: string | null } | null;
  nom_client_organisateur: string | null;
  reference_affaire: string | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
  lieu: LieuFiche | null;
}

export interface AssociationFiche {
  nom: string;
  ville: string | null;
  description: string | null;
}

// 'absent' = bouton non affiché (statut qui ne le permet pas) ; 'grise' =
// affiché mais inactif (le statut le permet, pas le droit de CE rôle sur CETTE
// collecte — ex. commercial sur la collecte d'un autre, §06.04).
export type EtatAction = 'actif' | 'grise' | 'absent';

export interface ActionsFiche {
  modifier: EtatAction;
  annuler: EtatAction;
  // directe (brouillon/programmee) ou demande validée par l'Admin (validee).
  annulation: 'directe' | 'demande' | null;
}

export interface FicheCollecteClient {
  id: string;
  type: string;
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
  date_collecte: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_completes: boolean;
  informations_supplementaires: string | null;
  taux_recyclage: number | null;
  co2_net_kg: number | null;
  co2_evite_kg: number | null;
  realisee_at: string | null;
  aucun_repas_motif: string | null;
  taille_bracket: string | null;
  evenement: EvenementFiche | null;
  tournees: TourneeFiche[];
  // Une demande urgente est OUVERTE (une demande clôturée n'empêche pas d'en
  // refaire une — D10, arbitrage Val 2026-09-30).
  coordonnees_urgence_demandee: boolean;
  // ZD « Réalisée » : kg par code de flux (biodechet, emballage…).
  bilan_flux: Record<string, number> | null;
  // AG : repas donnés (attribution sous RLS ; à défaut, attestation de don —
  // cas du gestionnaire sur une collecte de traiteur tiers, D13).
  repas_donnes: number | null;
  // Absente pour le gestionnaire (Q7 : tant que v_attributions_gestionnaire
  // n'existe pas, la clé n'est même pas dans la réponse).
  association?: AssociationFiche | null;
  rapport_rse_disponible: boolean;
  rapport_rse_regenere: boolean;
  // Traiteur opérationnel d'une collecte AG programmée par une autre
  // organisation : l'attestation de don est émise au nom du donneur d'ordre et
  // ne lui est pas servie (att_traiteur_select — D12, arbitrage Val 2026-09-30).
  rapport_reserve_donneur_ordre: boolean;
  actions: ActionsFiche;
}

function renseigne(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * Coordonnées d'un camion reçues : nom + téléphone + plaque (vélo cargo : pas de
 * plaque attendue). Même règle que le trigger SQL qui clôture l'alerte urgente
 * (migration 20260929160000) — une chaîne vide reste « En attente ».
 */
export function coordonneesCamionCompletes(t: TourneeFiche): boolean {
  return (
    renseigne(t.chauffeur_nom) &&
    renseigne(t.chauffeur_telephone) &&
    (renseigne(t.plaque_immatriculation) || t.type_vehicule === 'velo_cargo')
  );
}

/** Toutes les coordonnées reçues : au moins un camion, tous complets. */
export function coordonneesCompletes(tournees: TourneeFiche[]): boolean {
  return tournees.length > 0 && tournees.every(coordonneesCamionCompletes);
}
