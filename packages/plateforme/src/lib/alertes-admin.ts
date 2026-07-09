// Présentation des alertes Admin in-app (table plateforme.alertes_admin).
// Source unique pour l'écran /admin/alertes : sévérité par code, libellé de
// sévérité (→ variante Badge), et lien profond vers l'entité concernée.
//
// Contexte : la table est peuplée par f_upsert_alerte_admin depuis ~9 émetteurs
// (triggers packs, pesées, PDF/Pennylane, dispatch AG, shadow, override lieu,
// adapters logistiques, webhooks transporteurs). §07 Observabilité /03 §3 fige
// que ces alertes FONCTIONNELLES restent in-app (« le canal d'action est l'écran
// Admin »), jamais poussées sur Slack. Cet écran est ce canal.

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
  // À traiter — anomalie à instruire, sans urgence bloquante.
  ag_annulee_tardive_sans_pack_actif: 'attention',
  attribution_aucun_prestataire: 'attention',
  attribution_aucune_asso: 'attention',
  pack_ag_bas: 'attention',
  pesee_hors_seuil: 'attention',
  reduction_camions_bloquee: 'attention',
  collecte_partiellement_servie: 'attention',
  collecte_aucun_repas: 'attention',
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
      return `/admin/collectes/${entityId}`;
    case 'organisations':
      return `/admin/clients/${entityId}`;
    case 'factures':
      return `/admin/factures/${entityId}`;
    case 'lieux':
      return `/admin/lieux/${entityId}`;
    default:
      return null;
  }
}
