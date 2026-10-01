/**
 * Contrats front des blocs §11 « liste/ranking » servis par
 * GET /api/v1/dashboards/blocs (Bloc 3 AG / 6 / 7 + kg/pax par flux ZD).
 * Source unique de types partagée par les composants et les pages des 3 rôles.
 */

export interface TopLieu {
  lieu_id: string;
  lieu_nom: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}

export interface TopActeur {
  id: string;
  label: string;
  nb_collectes: number;
  tonnage_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  repas_par_pax: number | null;
}

export interface TopAssociation {
  association_id: string;
  nom: string;
  ville: string | null;
  nb_collectes: number;
  repas_recus: number;
}

export interface BlocsData {
  topLieux: TopLieu[];
  topActeurs: TopActeur[] | null;
  acteurLabel: 'Commercial' | 'Traiteur' | null;
  topAssociations: TopAssociation[] | null;
  kgParPaxParFlux: Record<string, number>;
}
