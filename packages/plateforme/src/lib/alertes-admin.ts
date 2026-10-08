// Présentation des alertes Admin in-app (table plateforme.alertes_admin).
// Source unique pour l'écran /admin/alertes : sévérité par code, libellé de
// sévérité (→ variante Badge), et lien profond vers l'entité concernée.
//
// Contexte : la table est peuplée par f_upsert_alerte_admin depuis ~9 émetteurs
// (triggers packs, pesées, PDF/Pennylane, dispatch AG, shadow, override lieu,
// adapters logistiques, webhooks transporteurs). §07 Observabilité /03 §3 fige
// que ces alertes FONCTIONNELLES restent in-app (« le canal d'action est l'écran
// Admin »), jamais poussées sur Slack. Cet écran est ce canal.

import { ROUTES } from '@/lib/routes';
import {
  CODE_ALERTE_EMAIL_NON_REMIS,
  CODE_ALERTE_INFOS_ACCES_NON_REMISES,
} from '@/lib/emails/codes-alertes';
import { CODE_ALERTE_LIEU_AJOUT } from '@/lib/lieux/demande-ajout';
import { CODE_ALERTE_LIEU_MODIFICATION } from '@/lib/lieux/demande-modification';

export type AlerteSeverite = 'critique' | 'attention' | 'info';

// Sévérité par code connu. Un code absent retombe sur le classifieur par
// mots-clés (severiteParCode) puis 'info' — un NOUVEL émetteur reste affiché et
// correctement teinté sans modifier ce fichier.
const SEVERITE_PAR_CODE: Record<string, AlerteSeverite> = {
  // Critiques — action requise, risque métier/comptable/logistique.
  pack_ag_epuise: 'critique',
  ag_realisee_sans_pack_actif: 'critique',
  pdf_job_dead: 'critique',
  pennylane_echec_final: 'critique',
  collecte_rejetee_prestataire: 'critique',
  pesee_divergence_post_cloture: 'critique',
  bordereau_pesees_manquantes_48h: 'critique',
  // Attestation fiscale 2041-GE différée : donateur sans SIRET vérifié.
  attestation_ag_siret_donateur_manquant: 'critique',
  // Client qui demande en urgence les coordonnées du chauffeur (fiche collecte,
  // §06.04 refonte 2026-09-29) : clôturée automatiquement à leur réception.
  coordonnees_chauffeur_urgence: 'critique',
  // Email définitivement perdu (4 tentatives épuisées, ou refus de la messagerie
  // du destinataire) — même rang que les échecs finaux PDF et Pennylane (§08 §6).
  [CODE_ALERTE_EMAIL_NON_REMIS]: 'critique',
  // Email des coordonnées chauffeur non parvenu au programmateur : le contrôle
  // d'accès du site n'a pas le nom du chauffeur. Close automatiquement si
  // l'email finit par partir.
  [CODE_ALERTE_INFOS_ACCES_NON_REMISES]: 'critique',
  // À traiter — anomalie à instruire, sans urgence bloquante.
  ag_annulee_tardive_sans_pack_actif: 'attention',
  attribution_aucun_prestataire: 'attention',
  attribution_aucune_asso: 'attention',
  pack_ag_bas: 'attention',
  pesee_hors_seuil: 'attention',
  reduction_camions_bloquee: 'attention',
  collecte_partiellement_servie: 'attention',
  collecte_aucun_repas: 'attention',
  // Une tournée d'un autre transporteur reste rattachée à la collecte : un camion
  // ou un vélo peut encore rouler dessus. Ni les regex de repli ni le défaut ne
  // l'auraient teintée — elle se serait affichée en « Info » (gris).
  tournee_autre_provider: 'attention',
  // Une course A Toutes! qui n'est plus celle de la collecte annonce un vélo
  // actif : risque de double passage (M14 EC11, warning). Même angle mort que
  // ci-dessus : aucun mot-clé de repli ne la teinte.
  everest_mission_hors_attribution: 'attention',
  // Gestionnaire qui demande la correction d'une information de son lieu (fiche
  // lieu, bouton « Demande de modification d'information ») : l'Admin corrige
  // la fiche puis résout l'alerte — tant qu'elle est ouverte, le gestionnaire
  // ne peut pas en déposer une autre pour ce lieu.
  [CODE_ALERTE_LIEU_MODIFICATION]: 'attention',
  // Gestionnaire qui demande le rattachement d'un nouveau lieu (liste Lieux,
  // bouton « Demander l'ajout d'un lieu ») : l'Admin crée ou rattache le lieu
  // puis résout l'alerte, rattachée à l'organisation qui demande.
  [CODE_ALERTE_LIEU_AJOUT]: 'attention',
  // Informatives — trace d'un événement à connaître.
  shadow_traiteur_cree: 'info',
  shadow_siret_complete: 'info',
  lieu_override_programmation: 'info',
};

export function severiteParCode(code: string): AlerteSeverite {
  const explicite = SEVERITE_PAR_CODE[code];
  if (explicite) return explicite;
  // Fallback par mots-clés : un émetteur futur non catalogué reste correctement
  // teinté (defensif — jamais d'alerte affichée en gris par défaut à tort).
  if (/epuise|dead|echec|rejet|divergence|manquant|sans_pack/.test(code))
    return 'critique';
  if (/bas|hors_seuil|bloque|partiel|aucun|override/.test(code))
    return 'attention';
  return 'info';
}

export const SEVERITE_BADGE: Record<
  AlerteSeverite,
  { label: string; variant: 'error' | 'warning' | 'neutral' }
> = {
  critique: { label: 'Critique', variant: 'error' },
  attention: { label: 'À traiter', variant: 'warning' },
  info: { label: 'Info', variant: 'neutral' },
};

// Lien profond vers la fiche back-office de l'entité concernée, ou null si
// l'entité n'a pas de page Admin dédiée (ex. pack_antgaspi, géré sous
// l'organisation → l'écran affiche alors le type + l'id brut, sans lien mort).
export function entiteHref(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    // Le pluriel/singulier varie selon l'émetteur (collecte vs collectes).
    case 'collecte':
    case 'collectes':
      return ROUTES.admin.collecte(entityId);
    case 'organisations':
      return ROUTES.admin.client(entityId);
    case 'factures':
      return ROUTES.admin.facture(entityId);
    case 'lieux':
      // La fiche lieu est une modale ouverte sur la liste (pas de page dédiée) :
      // ?edit={id} ouvre directement la modale d'édition.
      return `${ROUTES.admin.lieux}?edit=${entityId}`;
    default:
      return null;
  }
}
