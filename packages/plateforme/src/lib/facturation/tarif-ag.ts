// Résolution du tarif AG (Anti-Gaspi) à la facturation par collecte.
// Source de vérité : 06 - Génération et édition facture (Admin) §5 « Édition
// manuelle du montant » > AG (par collecte) :
//   - Pack `par_collecte`        → PU = prix unitaire du pack
//     (`packs_antgaspi.prix_unitaire_ht`) ; `personnalise` → montant_total_ht / credits_initiaux.
//   - Aucun pack (hors pack)     → base = tarif unitaire public (`tarifs_packs_ag`
//     type_pack='unitaire', 590 €) MOINS les remises AG éligibles
//     (`tarifs_negocie` activite='ag', scope='organisation', cumul multiplicatif).
//   - Pack `globale_achat`       → facturé au pack (FPK), pas à la collecte → skip.
// Le 590 € en dur de l'ancien batch (surfacturation Pack 30/60 + remises AG ignorées)
// est supprimé : tout vient désormais du référentiel (BL-P1-FACT-02/03).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

export class TarifAgError extends Error {
  constructor(
    message: string,
    public readonly code: 'TARIF_UNITAIRE_INTROUVABLE' | 'PU_PACK_INTROUVABLE',
  ) {
    super(message);
    this.name = 'TarifAgError';
  }
}

// `source` = nature descriptive (stockée dans tarif_detail).
export type TarifAgSource = 'ag_pack_par_collecte' | 'ag_unitaire';
// `tarif_applique_source` = valeur de l'enum DB plateforme.tarif_source
// (FIXÉ à zd_grille|ag_unitaire|libre — cf. 04 - Data Model §tarif_applique_source).
// Pack par_collecte = base hors barème public (PU snapshot du pack, pas de FK
// tarifs_packs_ag) → 'libre' (tarif_applique_id NULL) ; hors pack = 'ag_unitaire'.
export type TarifSourceEnum = 'ag_unitaire' | 'libre';

export type TarifAgResult =
  | { skip: true }
  | {
      skip: false;
      montant_ht: number;
      montant_brut_ht: number;
      source: TarifAgSource;
      tarif_applique_source: TarifSourceEnum;
      tarif_applique_id: string | null;
      remise_pct_cumulee: number;
      tarif_detail: Record<string, unknown>;
    };

interface PackPricing {
  mode_facturation: string;
  prix_unitaire_ht: number | null;
  montant_total_ht: number | null;
  credits_initiaux: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function calculer_tarif_ag(
  supabase: SupabaseClient,
  params: {
    packAntgaspiId: string | null;
    organisationId: string;
    date: Date;
  },
): Promise<TarifAgResult> {
  const dateStr = params.date.toISOString().slice(0, 10);

  // ── Cas 1 : la collecte décrémente un pack ──────────────────────────────────
  if (params.packAntgaspiId) {
    const { data } = await supabase
      .from('packs_antgaspi')
      .select(
        'mode_facturation, prix_unitaire_ht, montant_total_ht, credits_initiaux',
      )
      .eq('id', params.packAntgaspiId)
      .single();

    const pack = data as PackPricing | null;

    // Pack au mode global : la facture d'achat (FPK) couvre déjà ces collectes.
    if (pack?.mode_facturation === 'globale_achat') return { skip: true };

    // Mode `par_collecte` : PU = prix unitaire du pack (snapshot à l'achat).
    // `personnalise` (ou snapshot manquant) → montant_total_ht / credits_initiaux.
    let pu = pack?.prix_unitaire_ht ?? null;
    if (
      pu == null &&
      pack?.montant_total_ht != null &&
      pack.credits_initiaux != null &&
      pack.credits_initiaux > 0
    ) {
      pu = pack.montant_total_ht / pack.credits_initiaux;
    }
    if (pu == null) {
      throw new TarifAgError(
        `Prix unitaire introuvable pour le pack ${params.packAntgaspiId}`,
        'PU_PACK_INTROUVABLE',
      );
    }

    const montant = round2(Number(pu));
    return {
      skip: false,
      montant_ht: montant,
      montant_brut_ht: montant,
      source: 'ag_pack_par_collecte',
      tarif_applique_source: 'libre',
      tarif_applique_id: null,
      remise_pct_cumulee: 0,
      tarif_detail: {
        source: 'ag_pack_par_collecte',
        pack_antgaspi_id: params.packAntgaspiId,
        prix_unitaire_ht: montant,
      },
    };
  }

  // ── Cas 2 : hors pack → tarif unitaire public − remises AG ──────────────────
  const { data: tarifUnitaire } = await supabase
    .from('tarifs_packs_ag')
    .select('id, prix_unitaire_ht')
    .eq('type_pack', 'unitaire')
    .lte('valide_du', dateStr)
    .or(`valide_jusqu_au.is.null,valide_jusqu_au.gte.${dateStr}`)
    .single();

  if (!tarifUnitaire) {
    throw new TarifAgError(
      'Aucun tarif AG unitaire actif dans tarifs_packs_ag',
      'TARIF_UNITAIRE_INTROUVABLE',
    );
  }

  const base = Number(tarifUnitaire.prix_unitaire_ht);

  // Remises AG : scope=organisation uniquement (la remise gestionnaire est ZD).
  // Cumul multiplicatif Π(1 − remise_pct), comme le chemin ZD.
  const { data: remises } = await supabase
    .from('tarifs_negocie')
    .select('remise_pct')
    .eq('activite', 'ag')
    .eq('scope', 'organisation')
    .eq('organisation_id', params.organisationId)
    .lte('valide_du', dateStr)
    .or(`valide_jusqu_au.is.null,valide_jusqu_au.gte.${dateStr}`);

  let facteurRemise = 1;
  if (remises && remises.length > 0) {
    facteurRemise = remises.reduce(
      (acc: number, r: { remise_pct: number }) =>
        acc * (1 - Number(r.remise_pct)),
      1,
    );
  }

  const montant = round2(base * facteurRemise);
  return {
    skip: false,
    montant_ht: montant,
    montant_brut_ht: base,
    source: 'ag_unitaire',
    tarif_applique_source: 'ag_unitaire',
    tarif_applique_id: (tarifUnitaire as { id: string }).id,
    remise_pct_cumulee: round2(1 - facteurRemise),
    tarif_detail: {
      source: 'ag_unitaire',
      base_ht: base,
      remise_pct_cumulee: round2(1 - facteurRemise),
    },
  };
}
