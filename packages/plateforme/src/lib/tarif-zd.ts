import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { facteurRemisesNegociees } from '@/lib/facturation/remises-negociees.js';

export class TarifZdError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PAX_INVALIDE'
      | 'GRILLE_INTROUVABLE'
      | 'TARIF_INTROUVABLE',
  ) {
    super(message);
    this.name = 'TarifZdError';
  }
}

export interface TarifZdResult {
  montant_ht: number;
  montant_brut_ht: number;
  grille_id: string;
  tarif_id: string;
  remise_pct_cumulee: number;
}

async function trouverGrilleActive(
  supabase: SupabaseClient,
  grilleId: string,
  dateStr: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('grilles_tarifaires_zd')
    .select('id')
    .eq('id', grilleId)
    .eq('actif', true)
    .lte('valide_du', dateStr)
    .or(`valide_jusqu.is.null,valide_jusqu.gte.${dateStr}`)
    .single();
  return data?.id ?? null;
}

async function trouverGrilleDefaut(
  supabase: SupabaseClient,
  dateStr: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('grilles_tarifaires_zd')
    .select('id')
    .eq('est_defaut', true)
    .eq('actif', true)
    .lte('valide_du', dateStr)
    .or(`valide_jusqu.is.null,valide_jusqu.gte.${dateStr}`)
    .single();
  return data?.id ?? null;
}

export async function calculer_tarif_zd(
  pax: number,
  organisationId: string | null,
  date: Date,
  supabase: SupabaseClient,
  lieuId: string | null = null,
): Promise<TarifZdResult> {
  if (!Number.isInteger(pax) || pax < 1) {
    throw new TarifZdError(
      `Le nombre de couverts doit être un entier ≥ 1 (reçu : ${pax})`,
      'PAX_INVALIDE',
    );
  }

  const dateStr = jourParis(date);

  // 1. Résoudre la grille active pour cette organisation et cette date
  let grilleId: string | null = null;

  if (organisationId) {
    const { data: org } = await supabase
      .from('organisations')
      .select('grille_tarifaire_zd_id')
      .eq('id', organisationId)
      .single();

    const orgGrilleId = org?.grille_tarifaire_zd_id ?? null;

    if (orgGrilleId) {
      grilleId = await trouverGrilleActive(supabase, orgGrilleId, dateStr);
    }
  }

  if (!grilleId) {
    grilleId = await trouverGrilleDefaut(supabase, dateStr);
  }

  if (!grilleId) {
    throw new TarifZdError(
      'Aucune grille tarifaire ZD active trouvée pour cette date',
      'GRILLE_INTROUVABLE',
    );
  }

  // 2. Trouver le palier correspondant au pax
  const { data: tarif } = await supabase
    .from('tarifs_zero_dechet')
    .select('id, prix_base_ht, prix_par_couvert_ht')
    .eq('grille_id', grilleId)
    .lte('pax_min', pax)
    .or(`pax_max.is.null,pax_max.gte.${pax}`)
    .single();

  if (!tarif) {
    throw new TarifZdError(
      `Aucun palier tarifaire ZD pour ${pax} pax (grille ${grilleId})`,
      'TARIF_INTROUVABLE',
    );
  }

  const montantBrut =
    Number(tarif.prix_base_ht) +
    (tarif.prix_par_couvert_ht !== null
      ? Number(tarif.prix_par_couvert_ht) * pax
      : 0);

  // 3. Remises négociées éligibles : organisation programmatrice + gestionnaire
  //    du lieu de l'événement (§05 résolution du prix, étape 3).
  const facteurRemise = await facteurRemisesNegociees(supabase, {
    activite: 'zd',
    organisationId,
    lieuId,
    dateStr,
  });

  const remisePctCumulee = 1 - facteurRemise;
  const montantHt = Math.round(montantBrut * facteurRemise * 100) / 100;

  return {
    montant_ht: montantHt,
    montant_brut_ht: montantBrut,
    grille_id: grilleId,
    tarif_id: tarif.id,
    remise_pct_cumulee: remisePctCumulee,
  };
}
