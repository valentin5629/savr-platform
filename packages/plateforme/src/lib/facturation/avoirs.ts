// Avoir intégral sur une facture 'emise' ou 'payee'.
// Crée la facture avoir + lignes négatives + push Pennylane credit_note.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  createInvoice,
  finalizeInvoice,
  sendInvoiceEmail,
  is4xx,
  is429,
} from '../pennylane/client.js';
import { attribuerNumeroFacture } from './numerotation.js';

export interface AvoirResult {
  ok: boolean;
  avoir_id?: string;
  numero_avoir?: string;
  erreur?: string;
}

interface FactureOrigine {
  id: string;
  type: string;
  statut: string;
  montant_ht: number;
  taux_tva: number;
  montant_tva: number;
  montant_ttc: number;
  devise: string;
  organisation_id: string;
  entite_facturation_id: string;
  pennylane_id: string | null;
  factures_collectes: Array<{
    id: string;
    collecte_id: string | null;
    designation: string | null;
    libelle_ligne: string | null;
    quantite: number;
    montant_ligne_ht: number;
    taux_tva: number;
    tarif_applique_id: string | null;
    tarif_applique_source: string | null;
    tarif_detail: Record<string, unknown> | null;
  }>;
  entites_facturation: {
    pennylane_customer_id: string | null;
    raison_sociale: string;
    siret: string | null;
    tva_intracom: string | null;
    conditions_paiement_jours: number;
  } | null;
}

export async function creerAvoir(
  supabase: SupabaseClient,
  factureId: string,
  motif: string,
): Promise<AvoirResult> {
  // 1. Charger la facture d'origine
  const { data, error: loadErr } = await supabase
    .from('factures')
    .select(
      `id, type, statut, montant_ht, taux_tva, montant_tva, montant_ttc, devise,
       organisation_id, entite_facturation_id, pennylane_id,
       factures_collectes (
         id, collecte_id, designation, libelle_ligne, quantite,
         montant_ligne_ht, taux_tva, tarif_applique_id, tarif_applique_source, tarif_detail
       ),
       entites_facturation (
         pennylane_customer_id, raison_sociale, siret, tva_intracom, conditions_paiement_jours
       )`,
    )
    .eq('id', factureId)
    .single();

  if (loadErr || !data) return { ok: false, erreur: 'Facture introuvable' };

  const origine = data as unknown as FactureOrigine;

  if (!['emise', 'payee'].includes(origine.statut)) {
    return {
      ok: false,
      erreur: `Avoir impossible sur statut "${origine.statut}"`,
    };
  }

  // 2. (M9) Le numéro AV n'est PAS attribué ici. Il l'est au plus tard, juste
  // avant le push Pennylane (cf. étape 5) — sinon un INSERT d'avoir en échec
  // laisserait un trou dans la séquence gapless. L'avoir est créé en brouillon
  // sans numéro.
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]!;

  // 3. Créer la facture avoir (montants négatifs)
  const { data: avoir, error: avoirErr } = await supabase
    .from('factures')
    .insert({
      organisation_id: origine.organisation_id,
      entite_facturation_id: origine.entite_facturation_id,
      facture_origine_id: factureId,
      type: 'avoir',
      mode_facturation: 'par_collecte',
      statut: 'brouillon',
      montant_ht: -origine.montant_ht,
      taux_tva: origine.taux_tva,
      montant_tva: -origine.montant_tva,
      montant_ttc: -origine.montant_ttc,
      devise: origine.devise,
      motif_avoir: motif,
      date_emission: dateStr,
      date_echeance: dateStr,
    })
    .select('id')
    .single();

  if (avoirErr || !avoir) {
    return { ok: false, erreur: `INSERT avoir : ${avoirErr?.message}` };
  }

  const avoir_id = (avoir as { id: string }).id;

  // 4. Créer les lignes avoir (montants négatifs)
  const lignes = origine.factures_collectes.map((fc) => ({
    facture_id: avoir_id,
    collecte_id: fc.collecte_id,
    designation: fc.designation,
    libelle_ligne: fc.libelle_ligne,
    quantite: fc.quantite,
    taux_tva: fc.taux_tva,
    tarif_applique_id: fc.tarif_applique_id,
    tarif_applique_source: fc.tarif_applique_source,
    tarif_detail: fc.tarif_detail,
    montant_ligne_ht: -fc.montant_ligne_ht,
    montant_ht: -fc.montant_ligne_ht,
  }));

  await supabase.from('factures_collectes').insert(lignes);

  // 5. (M9) Attribuer le numéro AV au plus tard : l'INSERT de l'avoir + des
  // lignes a réussi, consommer un numéro est désormais sûr (pas de trou si
  // l'INSERT avait échoué). Le numéro est conservé sur le brouillon en cas
  // d'échec du push → la reprise (renvoyerFacture) le réutilise, gapless.
  // NB : l'origine N'EST PLUS annulée ici — c'est le trigger
  // trg_avoir_annule_origine qui le fait quand l'avoir atteint 'emise' (succès
  // du push), ce qui couvre aussi la reprise via le worker retry.
  const numeroAvoir = await attribuerNumeroFacture(supabase, 'AV');

  // 6. Push Pennylane credit_note (même flux que facture normale)
  const ef = origine.entites_facturation;
  const pennylanePayload: Record<string, unknown> = {
    customer: {
      id: ef?.pennylane_customer_id ?? undefined,
      name: ef?.raison_sociale,
    },
    invoice_number: numeroAvoir,
    date: dateStr,
    deadline: dateStr,
    currency: origine.devise,
    source_id: avoir_id,
    // FACT-08 — contrat Pennylane v2 réel : un avoir est un customer_invoice de
    // `type: 'credit_note'` (§08 « Créer avoir : POST /customer_invoices type=credit_note »).
    // L'ancien `is_credit_note: true` n'existe pas dans l'API v2 → échec au 1er prod.
    type: 'credit_note',
    credit_note_origin_id: origine.pennylane_id ?? undefined,
    line_items: origine.factures_collectes.map((fc) => ({
      label: fc.libelle_ligne ?? fc.designation ?? 'Avoir Savr',
      quantity: fc.quantite,
      unit_price: -fc.montant_ligne_ht,
      vat_rate: fc.taux_tva,
      amount: -fc.montant_ligne_ht * fc.quantite,
    })),
  };

  // Marquer en_attente_pennylane + enregistrer le numéro (conservé si échec)
  await supabase
    .from('factures')
    .update({
      statut: 'en_attente_pennylane',
      numero_facture: numeroAvoir,
      pennylane_statut: 'processing',
      derniere_tentative_pennylane_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', avoir_id);

  const createRes = await createInvoice(supabase, pennylanePayload, avoir_id);

  if (!createRes.ok) {
    // 429 exclu du terminal 4xx → retenté (VOLET 3 R22g).
    const is4 = is4xx(createRes) && !is429(createRes);
    await supabase
      .from('factures')
      .update({
        statut: is4 ? 'brouillon' : 'en_attente_pennylane',
        pennylane_statut: is4 ? 'echec_4xx' : 'retry_1',
        erreur_synchro: createRes.message,
        erreur_synchro_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', avoir_id);

    return {
      ok: false,
      avoir_id,
      numero_avoir: numeroAvoir,
      erreur: createRes.message,
    };
  }

  const plId = createRes.invoice.id;
  await supabase
    .from('factures')
    .update({ pennylane_id: plId })
    .eq('id', avoir_id);

  const finalizeRes = await finalizeInvoice(supabase, plId);
  if (!finalizeRes.ok) {
    await supabase
      .from('factures')
      .update({
        pennylane_statut: 'retry_1',
        erreur_synchro: finalizeRes.message,
        erreur_synchro_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', avoir_id);
    return {
      ok: false,
      avoir_id,
      numero_avoir: numeroAvoir,
      erreur: finalizeRes.message,
    };
  }

  await sendInvoiceEmail(supabase, plId); // non bloquant si fail — la facture est déjà finalisée

  await supabase
    .from('factures')
    .update({
      statut: 'emise',
      pennylane_statut: 'sent',
      pennylane_push_at: now.toISOString(),
      pdf_url_pennylane: finalizeRes.invoice.file_url ?? null,
      updated_at: now.toISOString(),
    })
    .eq('id', avoir_id);

  return { ok: true, avoir_id, numero_avoir: numeroAvoir };
}
