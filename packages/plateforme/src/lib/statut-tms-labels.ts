import type { BadgeProps } from '@/components/ui/badge';

// Affichage du statut TMS (§08 §3bis.6) — libellés FR + variant Badge pour les
// valeurs réelles de l'enum `statut_tms` (aucun statut inventé ; toute valeur non
// mappée retombe sur son libellé brut, neutre). UX uniquement — la DB garde l'enum.
type Variant = NonNullable<BadgeProps['variant']>;

export const STATUT_TMS_DISPLAY: Record<
  string,
  { label: string; variant: Variant }
> = {
  non_envoye: { label: 'Non envoyé', variant: 'neutral' },
  a_attribuer: { label: 'À attribuer', variant: 'neutral' },
  attribuee_en_attente_acceptation: {
    label: 'Attente acceptation presta',
    variant: 'warning',
  },
  acceptee: { label: 'Acceptée presta', variant: 'success' },
  en_attente_execution: { label: 'En attente exécution', variant: 'info' },
  rejetee_par_prestataire: {
    label: 'Rejetée par prestataire',
    variant: 'error',
  },
  annulee_par_traiteur: { label: 'Annulée par traiteur', variant: 'error' },
  rejetee_par_tms: { label: 'Rejetée par TMS', variant: 'error' },
};

export function statutTmsDisplay(statutTms: string): {
  label: string;
  variant: Variant;
} {
  return (
    STATUT_TMS_DISPLAY[statutTms] ?? { label: statutTms, variant: 'neutral' }
  );
}

// BL-P3-12 — Picto plaque TMS (monitoring Admin interne, CDC §11) : vert si TOUTES
// les tournées de la collecte ont leur plaque_immatriculation renseignée, gris si
// au moins une manque. Collecte sans tournée = false (le picto n'est pas rendu à
// vide, le bloc Tournées lui-même n'apparaissant que si length > 0).
export function plaqueTmsComplete(
  tournees: { tournees: { plaque_immatriculation: string | null } }[],
): boolean {
  return (
    tournees.length > 0 &&
    tournees.every((ct) => Boolean(ct.tournees.plaque_immatriculation))
  );
}
