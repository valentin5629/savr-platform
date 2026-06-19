// Batch J+1 6h — génération automatique des brouillons de facture.
// ZD par collecte (défaut) ou mensuel groupé selon organisations.mode_facturation_zd.
// AG par collecte (hors pack globale_achat) à la clôture.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { calculer_tarif_zd } from '../tarif-zd.js';

export interface BatchBrouillonsResult {
  zd_par_collecte: number;
  zd_mensuel: number;
  ag_par_collecte: number;
  skipped_siret: number;
  errors: string[];
}

interface CollecteAFacturer {
  id: string;
  type: string;
  statut: string;
  annulee_cote_savr: boolean;
  pack_antgaspi_id: string | null;
  evenements: {
    id: string;
    organisation_id: string;
    pax: number | null;
    date_evenement: string;
    organisations: {
      mode_facturation_zd: string | null;
      grille_tarifaire_zd_id: string | null;
      entites_facturation: Array<{
        id: string;
        siret_verification: string;
      }> | null;
    } | null;
  } | null;
}

interface PackRow {
  mode_facturation: string;
}

async function entiteFacturationPrincipale(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<{ id: string; siret_verification: string } | null> {
  const { data } = await supabase
    .from('entites_facturation')
    .select('id, siret_verification')
    .eq('organisation_id', organisationId)
    .eq('entite_par_defaut', true)
    .single();
  return data as { id: string; siret_verification: string } | null;
}

export async function runBatchBrouillonsJ1(
  supabase: SupabaseClient,
): Promise<BatchBrouillonsResult> {
  const result: BatchBrouillonsResult = {
    zd_par_collecte: 0,
    zd_mensuel: 0,
    ag_par_collecte: 0,
    skipped_siret: 0,
    errors: [],
  };

  // Collectes ZD + AG cloturees sans brouillon de facture actif
  const { data: collectes, error: selErr } = await supabase
    .from('collectes')
    .select(
      `id, type, statut, annulee_cote_savr, pack_antgaspi_id,
       evenements!inner (
         id, organisation_id, pax, date_evenement,
         organisations!organisation_id (
           mode_facturation_zd, grille_tarifaire_zd_id,
           entites_facturation ( id, siret_verification )
         )
       )`,
    )
    .in('statut', ['cloturee', 'realisee_sans_collecte'])
    .eq('annulee_cote_savr', false);

  if (selErr) {
    result.errors.push(`SELECT collectes : ${selErr.message}`);
    return result;
  }
  if (!collectes?.length) return result;

  // Exclure celles déjà facturées (brouillon actif)
  const collecteIds = collectes.map((c: { id: string }) => c.id);
  const { data: dejasFC } = await supabase
    .from('factures_collectes')
    .select('collecte_id')
    .in('collecte_id', collecteIds)
    .not('facture_id', 'is', null);

  type FCRow = { collecte_id: string };
  const dejaIds = new Set(
    ((dejasFC ?? []) as FCRow[]).map((r) => r.collecte_id),
  );

  const aTraiter = (collectes as unknown as CollecteAFacturer[]).filter(
    (c) => !dejaIds.has(c.id),
  );

  const today = new Date();
  const moisCourant = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  for (const collecte of aTraiter) {
    try {
      const ev = collecte.evenements;
      if (!ev) continue;
      const orgId = ev.organisation_id;
      const org = ev.organisations;

      // Gate SIRET : vérifier entité de facturation principale
      const entiteList = org?.entites_facturation;
      const entite =
        entiteList?.[0] ?? (await entiteFacturationPrincipale(supabase, orgId));
      if (!entite || entite.siret_verification !== 'verifie') {
        result.skipped_siret++;
        continue;
      }

      if (collecte.type === 'zero_dechet') {
        await traiterCollecteZd(
          supabase,
          collecte,
          ev,
          org,
          entite,
          moisCourant,
          result,
        );
      } else if (collecte.type === 'anti_gaspi') {
        await traiterCollecteAg(supabase, collecte, ev, entite, result);
      }
    } catch (err) {
      result.errors.push(`collecte ${collecte.id}: ${String(err)}`);
    }
  }

  return result;
}

async function traiterCollecteZd(
  supabase: SupabaseClient,
  collecte: CollecteAFacturer,
  ev: NonNullable<CollecteAFacturer['evenements']>,
  org: NonNullable<
    NonNullable<CollecteAFacturer['evenements']>['organisations']
  > | null,
  entite: { id: string; siret_verification: string },
  moisCourant: string,
  result: BatchBrouillonsResult,
): Promise<void> {
  const pax = ev.pax ?? 0;
  const dateFacturation = new Date(ev.date_evenement);
  const tarifResult = await calculer_tarif_zd(
    pax,
    ev.organisation_id,
    dateFacturation,
    supabase,
  );

  const tarif_detail = {
    base: {
      source: 'zd_grille',
      ref_id: tarifResult.tarif_id,
      montant_ht: tarifResult.montant_brut_ht,
    },
    remises:
      tarifResult.remise_pct_cumulee > 0
        ? [{ pct: tarifResult.remise_pct_cumulee }]
        : [],
    montant_final_ht: tarifResult.montant_ht,
  };

  const modeFacturation = org?.mode_facturation_zd ?? 'par_collecte';

  if (modeFacturation === 'mensuelle') {
    await creerOuAjouterBrouillonMensuel(
      supabase,
      collecte,
      ev,
      entite,
      tarifResult,
      tarif_detail,
      moisCourant,
    );
    result.zd_mensuel++;
  } else {
    // Mode par_collecte (défaut)
    const { data: facture, error: fErr } = await supabase
      .from('factures')
      .insert({
        organisation_id: ev.organisation_id,
        entite_facturation_id: entite.id,
        type: 'zero_dechet',
        mode_facturation: 'par_collecte',
        statut: 'brouillon',
        montant_ht: tarifResult.montant_ht,
        taux_tva: 20,
        montant_tva: tarifResult.montant_ht * 0.2,
        montant_ttc: tarifResult.montant_ht * 1.2,
      })
      .select('id')
      .single();

    if (fErr || !facture)
      throw new Error(`INSERT facture ZD : ${fErr?.message}`);

    await supabase.from('factures_collectes').insert({
      facture_id: facture.id,
      collecte_id: collecte.id,
      quantite: 1,
      taux_tva: 20,
      tarif_applique_id: tarifResult.tarif_id,
      tarif_applique_source: 'zd_grille',
      tarif_detail,
      montant_ligne_ht: tarifResult.montant_ht,
      montant_ht: tarifResult.montant_ht,
    });

    result.zd_par_collecte++;
  }
}

async function creerOuAjouterBrouillonMensuel(
  supabase: SupabaseClient,
  collecte: CollecteAFacturer,
  ev: NonNullable<CollecteAFacturer['evenements']>,
  entite: { id: string; siret_verification: string },
  tarifResult: {
    montant_ht: number;
    tarif_id: string;
    remise_pct_cumulee: number;
    montant_brut_ht: number;
  },
  tarif_detail: Record<string, unknown>,
  moisCourant: string,
): Promise<void> {
  // Chercher un brouillon mensuel en cours pour cette orga + mois
  const { data: existing } = await supabase
    .from('factures')
    .select('id, montant_ht, montant_tva, montant_ttc')
    .eq('organisation_id', ev.organisation_id)
    .eq('type', 'zero_dechet')
    .eq('mode_facturation', 'mensuelle')
    .eq('statut', 'brouillon')
    .eq('periode_debut', `${moisCourant}-01`)
    .maybeSingle();

  type FactureRow = {
    id: string;
    montant_ht: number;
    montant_tva: number;
    montant_ttc: number;
  };

  if (existing) {
    const f = existing as FactureRow;
    // Ajouter la ligne sur le brouillon existant
    await supabase.from('factures_collectes').insert({
      facture_id: f.id,
      collecte_id: collecte.id,
      quantite: 1,
      taux_tva: 20,
      tarif_applique_id: tarifResult.tarif_id,
      tarif_applique_source: 'zd_grille',
      tarif_detail,
      montant_ligne_ht: tarifResult.montant_ht,
      montant_ht: tarifResult.montant_ht,
    });
    // Recalculer les totaux
    const newHt = Number(f.montant_ht) + tarifResult.montant_ht;
    await supabase
      .from('factures')
      .update({
        montant_ht: newHt,
        montant_tva: newHt * 0.2,
        montant_ttc: newHt * 1.2,
        updated_at: new Date().toISOString(),
      })
      .eq('id', f.id);
  } else {
    // Créer un nouveau brouillon mensuel
    const { data: facture, error: fErr } = await supabase
      .from('factures')
      .insert({
        organisation_id: ev.organisation_id,
        entite_facturation_id: entite.id,
        type: 'zero_dechet',
        mode_facturation: 'mensuelle',
        statut: 'brouillon',
        montant_ht: tarifResult.montant_ht,
        taux_tva: 20,
        montant_tva: tarifResult.montant_ht * 0.2,
        montant_ttc: tarifResult.montant_ht * 1.2,
        periode_debut: `${moisCourant}-01`,
      })
      .select('id')
      .single();

    if (fErr || !facture)
      throw new Error(`INSERT brouillon mensuel : ${fErr?.message}`);

    await supabase.from('factures_collectes').insert({
      facture_id: (facture as { id: string }).id,
      collecte_id: collecte.id,
      quantite: 1,
      taux_tva: 20,
      tarif_applique_id: tarifResult.tarif_id,
      tarif_applique_source: 'zd_grille',
      tarif_detail,
      montant_ligne_ht: tarifResult.montant_ht,
      montant_ht: tarifResult.montant_ht,
    });
  }
}

async function traiterCollecteAg(
  supabase: SupabaseClient,
  collecte: CollecteAFacturer,
  ev: NonNullable<CollecteAFacturer['evenements']>,
  entite: { id: string; siret_verification: string },
  result: BatchBrouillonsResult,
): Promise<void> {
  // AG hors pack ou pack par_collecte → brouillon FAG
  // AG pack globale_achat → pas de facture par collecte (facture au pack)
  if (collecte.pack_antgaspi_id) {
    const { data: pack } = await supabase
      .from('packs_antgaspi')
      .select('mode_facturation')
      .eq('id', collecte.pack_antgaspi_id)
      .single();

    const p = pack as PackRow | null;
    if (p?.mode_facturation === 'globale_achat') return; // brouillon FPK déjà créé au pack
  }

  // Montant AG : tarif unitaire standard ou libre (défaut = 590 HT)
  const montant_ht = 590;

  const { data: facture, error: fErr } = await supabase
    .from('factures')
    .insert({
      organisation_id: ev.organisation_id,
      entite_facturation_id: entite.id,
      type: 'collecte_antigaspi',
      mode_facturation: 'par_collecte',
      statut: 'brouillon',
      pack_antgaspi_id: collecte.pack_antgaspi_id,
      montant_ht,
      taux_tva: 20,
      montant_tva: montant_ht * 0.2,
      montant_ttc: montant_ht * 1.2,
    })
    .select('id')
    .single();

  if (fErr || !facture) throw new Error(`INSERT facture AG : ${fErr?.message}`);

  await supabase.from('factures_collectes').insert({
    facture_id: (facture as { id: string }).id,
    collecte_id: collecte.id,
    quantite: 1,
    taux_tva: 20,
    tarif_applique_source: 'ag_unitaire',
    montant_ligne_ht: montant_ht,
    montant_ht,
  });

  result.ag_par_collecte++;
}
