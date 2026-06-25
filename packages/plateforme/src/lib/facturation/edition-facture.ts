// Édition d'une facture brouillon (écran « passage obligé », 06.08 §4-5).
// Toutes les mutations sont GATÉES sur statut='brouillon' : une fois la facture
// émise, le calcul est figé (06.08 §5 « figement à l'émission »). L'override
// manuel du PU trace dans audit_log (FACT-05).
//
// Logique métier testable (les routes API restent fines, comme validation-admin /
// avoirs). Service-role : RLS contournée, le cloisonnement est porté par
// requireAdmin côté route.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface EditionResult {
  ok: boolean;
  erreur?: string;
  statut?: number; // code HTTP suggéré
}

interface LigneTotaux {
  quantite: number | null;
  taux_tva: number | null;
  montant_ligne_ht: number | null;
}

// Recalcule montant_ht / montant_tva / montant_ttc de la facture depuis ses lignes.
export async function recomputeFactureTotaux(
  supabase: SupabaseClient,
  factureId: string,
): Promise<{ montant_ht: number; montant_tva: number; montant_ttc: number }> {
  const { data: lignes } = await supabase
    .from('factures_collectes')
    .select('quantite, taux_tva, montant_ligne_ht')
    .eq('facture_id', factureId);

  let ht = 0;
  let tva = 0;
  for (const l of (lignes ?? []) as LigneTotaux[]) {
    const ligneHt = Number(l.montant_ligne_ht ?? 0) * Number(l.quantite ?? 1);
    ht += ligneHt;
    tva += ligneHt * (Number(l.taux_tva ?? 20) / 100);
  }
  const totaux = {
    montant_ht: round2(ht),
    montant_tva: round2(tva),
    montant_ttc: round2(ht + tva),
  };

  await supabase
    .from('factures')
    .update({ ...totaux, updated_at: new Date().toISOString() })
    .eq('id', factureId);

  return totaux;
}

async function factureBrouillon(
  supabase: SupabaseClient,
  factureId: string,
): Promise<{ ok: true } | EditionResult> {
  const { data } = await supabase
    .from('factures')
    .select('id, statut')
    .eq('id', factureId)
    .single();
  if (!data) return { ok: false, erreur: 'Facture introuvable', statut: 404 };
  if ((data as { statut: string }).statut !== 'brouillon') {
    return {
      ok: false,
      erreur: 'Édition impossible : la facture n’est plus au statut brouillon',
      statut: 409,
    };
  }
  return { ok: true };
}

// Bloc 1 / Bloc 5 — en-tête (dates, entité de facturation, conditions/notes).
export interface FactureHeaderPatch {
  date_emission?: string;
  date_echeance?: string;
  entite_facturation_id?: string;
  notes?: string | null;
}

export async function patchFactureHeader(
  supabase: SupabaseClient,
  factureId: string,
  patch: FactureHeaderPatch,
): Promise<EditionResult> {
  const gate = await factureBrouillon(supabase, factureId);
  if (!('ok' in gate) || gate.ok !== true) return gate as EditionResult;

  const update: Record<string, unknown> = {};
  if (patch.date_emission !== undefined)
    update.date_emission = patch.date_emission;
  if (patch.date_echeance !== undefined)
    update.date_echeance = patch.date_echeance;
  if (patch.entite_facturation_id !== undefined)
    update.entite_facturation_id = patch.entite_facturation_id;
  if (patch.notes !== undefined) update.notes = patch.notes;

  if (Object.keys(update).length === 0) {
    return { ok: false, erreur: 'Aucun champ modifiable fourni', statut: 422 };
  }
  update.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('factures')
    .update(update)
    .eq('id', factureId);
  if (error) return { ok: false, erreur: error.message, statut: 422 };
  return { ok: true };
}

// Bloc 3 — ajout d'une ligne (collecte existante OU ligne libre).
export interface NouvelleLigne {
  collecte_id?: string | null;
  designation?: string | null;
  quantite?: number;
  taux_tva?: number;
  montant_ligne_ht: number;
}

export async function ajouterLigne(
  supabase: SupabaseClient,
  factureId: string,
  ligne: NouvelleLigne,
): Promise<EditionResult> {
  const gate = await factureBrouillon(supabase, factureId);
  if (!('ok' in gate) || gate.ok !== true) return gate as EditionResult;

  // CHECK DB : collecte_id IS NOT NULL OR designation IS NOT NULL.
  if (!ligne.collecte_id && !ligne.designation) {
    return {
      ok: false,
      erreur: 'Une ligne exige une collecte OU une désignation libre',
      statut: 422,
    };
  }
  if (typeof ligne.montant_ligne_ht !== 'number') {
    return { ok: false, erreur: 'montant_ligne_ht requis', statut: 422 };
  }

  const { error } = await supabase.from('factures_collectes').insert({
    facture_id: factureId,
    collecte_id: ligne.collecte_id ?? null,
    designation: ligne.designation ?? null,
    quantite: ligne.quantite ?? 1,
    taux_tva: ligne.taux_tva ?? 20,
    montant_ligne_ht: ligne.montant_ligne_ht,
    montant_ht: ligne.montant_ligne_ht,
    // ligne ajoutée manuellement = base hors barème public (enum tarif_source)
    tarif_applique_source: 'libre',
    tarif_detail: { source: 'ajout_manuel_admin' },
  });
  // Le trigger fn_trg_fc_collecte_non_facturee peut rejeter (collecte déjà facturée).
  if (error) return { ok: false, erreur: error.message, statut: 409 };

  await recomputeFactureTotaux(supabase, factureId);
  return { ok: true };
}

// Bloc 2 — modification d'une ligne (désignation, quantité, TVA, override PU).
export interface LignePatch {
  designation?: string | null;
  quantite?: number;
  taux_tva?: number;
  montant_ligne_ht?: number;
}

export async function modifierLigne(
  supabase: SupabaseClient,
  factureId: string,
  ligneId: string,
  patch: LignePatch,
  userId: string,
): Promise<EditionResult> {
  const gate = await factureBrouillon(supabase, factureId);
  if (!('ok' in gate) || gate.ok !== true) return gate as EditionResult;

  const { data: old } = await supabase
    .from('factures_collectes')
    .select(
      'id, montant_ligne_ht, designation, quantite, taux_tva, tarif_detail',
    )
    .eq('id', ligneId)
    .eq('facture_id', factureId)
    .single();
  if (!old) return { ok: false, erreur: 'Ligne introuvable', statut: 404 };
  const ancien = old as {
    montant_ligne_ht: number | null;
    tarif_detail: Record<string, unknown> | null;
  };

  const update: Record<string, unknown> = {};
  if (patch.designation !== undefined) update.designation = patch.designation;
  if (patch.quantite !== undefined) update.quantite = patch.quantite;
  if (patch.taux_tva !== undefined) update.taux_tva = patch.taux_tva;

  // Override manuel du PU HT (FACT-05) — trace audit + figement dans tarif_detail.
  let puOverride = false;
  if (
    patch.montant_ligne_ht !== undefined &&
    Number(patch.montant_ligne_ht) !== Number(ancien.montant_ligne_ht)
  ) {
    update.montant_ligne_ht = patch.montant_ligne_ht;
    update.montant_ht = patch.montant_ligne_ht; // colonne legacy synchronisée
    update.tarif_detail = {
      ...(ancien.tarif_detail ?? {}),
      override_admin: true,
      montant_avant_override: ancien.montant_ligne_ht,
    };
    puOverride = true;
  }

  if (Object.keys(update).length === 0) {
    return { ok: false, erreur: 'Aucun champ modifiable fourni', statut: 422 };
  }

  const { error } = await supabase
    .from('factures_collectes')
    .update(update)
    .eq('id', ligneId);
  if (error) return { ok: false, erreur: error.message, statut: 422 };

  if (puOverride) {
    // FACT-05 — qui / quand / ancien / nouveau (non bloquant).
    try {
      await supabase.from('audit_log').insert({
        table_name: 'factures_collectes',
        record_id: ligneId,
        action: 'override_pu_facture',
        user_id: userId,
        old_values: { montant_ligne_ht: ancien.montant_ligne_ht },
        new_values: { montant_ligne_ht: patch.montant_ligne_ht },
      });
    } catch {
      /* audit non bloquant */
    }
  }

  await recomputeFactureTotaux(supabase, factureId);
  return { ok: true };
}

// Bloc 2 — suppression d'une ligne.
export async function supprimerLigne(
  supabase: SupabaseClient,
  factureId: string,
  ligneId: string,
): Promise<EditionResult> {
  const gate = await factureBrouillon(supabase, factureId);
  if (!('ok' in gate) || gate.ok !== true) return gate as EditionResult;

  const { error } = await supabase
    .from('factures_collectes')
    .delete()
    .eq('id', ligneId)
    .eq('facture_id', factureId);
  if (error) return { ok: false, erreur: error.message, statut: 422 };

  await recomputeFactureTotaux(supabase, factureId);
  return { ok: true };
}
