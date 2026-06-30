import type { BadgeProps } from '@/components/ui/badge';

/**
 * Libellés d'affichage du statut d'une collecte (UX uniquement — la table garde
 * les valeurs d'enum DB). Deux vues (décision Val 2026-06-30) :
 *
 * - `admin`  : granularité complète (juste `brouillon` renommé « Créée »).
 * - `client` : vue simplifiée pour les rôles non-admin (traiteur, agence,
 *   gestionnaire de lieux, client organisateur). Jamais « Programmée » ;
 *   « Réalisée » seulement à `cloturee` ; le rejet prestataire est masqué
 *   (affiché « Créée », sujet interne Ops).
 */
export type StatutCollecteDb =
  | 'brouillon'
  | 'programmee'
  | 'validee'
  | 'en_cours'
  | 'realisee'
  | 'realisee_sans_collecte'
  | 'cloturee'
  | 'annulation_demandee'
  | 'annulee'
  | 'rejetee_par_prestataire';

export type VueStatut = 'admin' | 'client';

type Variant = NonNullable<BadgeProps['variant']>;

export interface StatutDisplay {
  label: string;
  variant: Variant;
}

// Vue admin — granularité métier complète. `brouillon` → « Créée ».
const ADMIN: Record<StatutCollecteDb, StatutDisplay> = {
  brouillon: { label: 'Créée', variant: 'neutral' },
  programmee: { label: 'Programmée', variant: 'neutral' },
  validee: { label: 'Validée', variant: 'primary' },
  en_cours: { label: 'En cours', variant: 'info' },
  realisee: { label: 'Réalisée', variant: 'success' },
  realisee_sans_collecte: { label: 'Sans excédents', variant: 'warning' },
  cloturee: { label: 'Clôturée', variant: 'neutral' },
  annulation_demandee: { label: 'Annulation demandée', variant: 'error' },
  annulee: { label: 'Annulée', variant: 'error' },
  rejetee_par_prestataire: { label: 'Rejetée', variant: 'error' },
};

// Vue client (non-admin) — collapse 2026-06-30 (Val) :
//   brouillon, programmee, rejetee_par_prestataire → « Créée »
//   realisee → « En cours » (« Réalisée » réservé à cloturee)
const CLIENT: Record<StatutCollecteDb, StatutDisplay> = {
  brouillon: { label: 'Créée', variant: 'neutral' },
  programmee: { label: 'Créée', variant: 'neutral' },
  validee: { label: 'Validée', variant: 'primary' },
  en_cours: { label: 'En cours', variant: 'info' },
  realisee: { label: 'En cours', variant: 'info' },
  realisee_sans_collecte: { label: 'Sans excédents', variant: 'warning' },
  cloturee: { label: 'Réalisée', variant: 'success' },
  annulation_demandee: { label: 'Annulée', variant: 'error' },
  annulee: { label: 'Annulée', variant: 'error' },
  rejetee_par_prestataire: { label: 'Créée', variant: 'neutral' },
};

/**
 * Résout (label, variant Badge) pour un statut DB selon la vue. Statut inconnu
 * (ne devrait pas arriver, enum fermé) → neutre avec la valeur brute (défensif).
 */
export function statutCollecteDisplay(
  statut: string,
  vue: VueStatut = 'admin',
): StatutDisplay {
  const map = vue === 'client' ? CLIENT : ADMIN;
  return (
    map[statut as StatutCollecteDb] ?? { label: statut, variant: 'neutral' }
  );
}
