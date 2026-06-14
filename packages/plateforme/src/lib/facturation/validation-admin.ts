// Validation Admin d'une facture brouillon : attribution numéro gapless + push Pennylane 3 appels.
// 4xx → retour brouillon, numéro conservé, erreur_synchro.
// 5xx → en_attente_pennylane + pennylane_statut='retry_1', cron retry.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  createInvoice,
  finalizeInvoice,
  sendInvoiceEmail,
  is4xx,
} from '../pennylane/client.js';
import {
  attribuerNumeroFacture,
  type SerieFacturation,
} from './numerotation.js';

export interface ValidationResult {
  ok: boolean;
  statut: 'emise' | 'brouillon' | 'en_attente_pennylane';
  numero_facture?: string;
  pennylane_id?: string;
  pdf_url_pennylane?: string;
  erreur?: string;
}

interface FactureRow {
  id: string;
  type: string;
  mode_facturation: string;
  statut: string;
  numero_facture: string | null;
  montant_ht: number;
  taux_tva: number;
  montant_tva: number;
  montant_ttc: number;
  devise: string;
  organisation_id: string;
  entite_facturation_id: string;
  notes: string | null;
  periode_debut: string | null;
  periode_fin: string | null;
  pennylane_statut: string | null;
  factures_collectes: Array<{
    id: string;
    designation: string | null;
    libelle_ligne: string | null;
    quantite: number;
    montant_ligne_ht: number;
    taux_tva: number;
    collectes?: {
      evenements?: { reference_affaire?: string | null } | null;
    } | null;
  }>;
  entites_facturation: {
    id: string;
    raison_sociale: string;
    siret: string | null;
    tva_intracom: string | null;
    adresse_facturation: string | null;
    code_postal: string | null;
    ville: string | null;
    pays: string | null;
    pennylane_customer_id: string | null;
    siret_verification: string;
    tva_verification: string;
    conditions_paiement_jours: number;
  } | null;
}

function serieFor(type: string): SerieFacturation {
  if (type === 'zero_dechet') return 'FZD';
  if (type === 'achat_pack_antigaspi') return 'FPK';
  if (type === 'avoir') return 'AV';
  return 'FAG';
}

function buildPennylanePayload(
  facture: FactureRow,
  numeroFacture: string,
  dateEmission: string,
  dateEcheance: string,
): Record<string, unknown> {
  const ef = facture.entites_facturation;
  const lignes = facture.factures_collectes.map((fc) => ({
    label: fc.libelle_ligne ?? fc.designation ?? 'Prestation Savr',
    quantity: fc.quantite,
    unit_price: fc.montant_ligne_ht,
    vat_rate: fc.taux_tva,
    amount: fc.montant_ligne_ht * fc.quantite,
  }));

  const referenceAffaire =
    facture.factures_collectes.find(
      (fc) => fc.collectes?.evenements?.reference_affaire,
    )?.collectes?.evenements?.reference_affaire ?? null;

  return {
    customer: {
      id: ef?.pennylane_customer_id ?? undefined,
      name: ef?.raison_sociale,
      billing_email: null,
      vat_number: ef?.tva_intracom ?? undefined,
      siret: ef?.siret ?? undefined,
    },
    invoice_number: numeroFacture,
    date: dateEmission,
    deadline: dateEcheance,
    currency: facture.devise,
    ...(referenceAffaire ? { reference: referenceAffaire } : {}),
    line_items: lignes,
    source_id: facture.id,
  };
}

export async function validerFacture(
  supabase: SupabaseClient,
  factureId: string,
): Promise<ValidationResult> {
  // 1. Charger la facture avec dépendances
  const { data: facture, error: loadErr } = await supabase
    .from('factures')
    .select(
      `id, type, mode_facturation, statut, numero_facture,
       montant_ht, taux_tva, montant_tva, montant_ttc, devise,
       organisation_id, entite_facturation_id, notes, periode_debut, periode_fin, pennylane_statut,
       factures_collectes (
         id, designation, libelle_ligne, quantite, montant_ligne_ht, taux_tva,
         collectes ( evenements ( reference_affaire ) )
       ),
       entites_facturation (
         id, raison_sociale, siret, tva_intracom,
         adresse_facturation, code_postal, ville, pays,
         pennylane_customer_id, siret_verification, tva_verification,
         conditions_paiement_jours
       )`,
    )
    .eq('id', factureId)
    .single();

  if (loadErr || !facture) {
    return { ok: false, statut: 'brouillon', erreur: 'Facture introuvable' };
  }

  const f = facture as unknown as FactureRow;

  if (f.statut !== 'brouillon') {
    return {
      ok: false,
      statut: 'brouillon',
      erreur: `Statut inattendu : ${f.statut}`,
    };
  }

  // Gate SIRET
  const ef = f.entites_facturation;
  if (!ef || ef.siret_verification !== 'verifie') {
    return {
      ok: false,
      statut: 'brouillon',
      erreur: 'SIRET non vérifié — envoi Pennylane bloqué',
    };
  }

  // 2. Attribuer le numéro (si pas déjà attribué après un 4xx précédent)
  let numeroFacture = f.numero_facture;
  if (!numeroFacture) {
    numeroFacture = await attribuerNumeroFacture(supabase, serieFor(f.type));
  }

  const now = new Date();
  const dateEmission = now.toISOString().split('T')[0]!;
  const jours = ef.conditions_paiement_jours ?? 30;
  const dateEcheance = new Date(now.getTime() + jours * 86400_000)
    .toISOString()
    .split('T')[0]!;

  // Passer en en_attente_pennylane + enregistrer le numéro
  await supabase
    .from('factures')
    .update({
      statut: 'en_attente_pennylane',
      numero_facture: numeroFacture,
      date_emission: dateEmission,
      date_echeance: dateEcheance,
      derniere_tentative_pennylane_at: now.toISOString(),
      pennylane_statut: 'processing',
      updated_at: now.toISOString(),
    })
    .eq('id', factureId);

  // 3. Appel Pennylane — create
  const payload = buildPennylanePayload(
    f,
    numeroFacture,
    dateEmission,
    dateEcheance,
  );
  const createRes = await createInvoice(payload, factureId);

  if (!createRes.ok) {
    const is4 = is4xx(createRes);
    await supabase
      .from('factures')
      .update({
        statut: is4 ? 'brouillon' : 'en_attente_pennylane',
        pennylane_statut: is4 ? 'echec_4xx' : 'retry_1',
        erreur_synchro: createRes.message,
        erreur_synchro_at: new Date().toISOString(),
        derniere_tentative_pennylane_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', factureId);

    return {
      ok: false,
      statut: is4 ? 'brouillon' : 'en_attente_pennylane',
      numero_facture: numeroFacture,
      erreur: createRes.message,
    };
  }

  const pennylaneId = createRes.invoice.id;
  await supabase
    .from('factures')
    .update({ pennylane_id: pennylaneId })
    .eq('id', factureId);

  // 4. Finalize
  const finalizeRes = await finalizeInvoice(pennylaneId);
  if (!finalizeRes.ok) {
    await supabase
      .from('factures')
      .update({
        pennylane_statut: 'retry_1',
        erreur_synchro: finalizeRes.message,
        erreur_synchro_at: new Date().toISOString(),
        derniere_tentative_pennylane_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', factureId);
    return {
      ok: false,
      statut: 'en_attente_pennylane',
      numero_facture: numeroFacture,
      pennylane_id: pennylaneId,
      erreur: finalizeRes.message,
    };
  }

  const pdfUrl = finalizeRes.invoice.file_url ?? null;

  // 5. Send email
  const emailRes = await sendInvoiceEmail(pennylaneId);
  if (!emailRes.ok) {
    await supabase
      .from('factures')
      .update({
        pennylane_statut: 'retry_1',
        pdf_url_pennylane: pdfUrl,
        erreur_synchro: emailRes.message,
        erreur_synchro_at: new Date().toISOString(),
        derniere_tentative_pennylane_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', factureId);
    return {
      ok: false,
      statut: 'en_attente_pennylane',
      numero_facture: numeroFacture,
      pennylane_id: pennylaneId,
      erreur: emailRes.message,
    };
  }

  // 6. Succès → emise
  await supabase
    .from('factures')
    .update({
      statut: 'emise',
      pennylane_statut: 'sent',
      pennylane_push_at: new Date().toISOString(),
      pdf_url_pennylane: pdfUrl,
      erreur_synchro: null,
      erreur_synchro_at: null,
      derniere_tentative_pennylane_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', factureId);

  return {
    ok: true,
    statut: 'emise',
    numero_facture: numeroFacture,
    pennylane_id: pennylaneId,
    pdf_url_pennylane: pdfUrl ?? undefined,
  };
}

// Retry manuel (bouton "Renvoyer") — repart de l'état en_attente_pennylane
// sans réattribuer le numéro.
export async function renvoyerFacture(
  supabase: SupabaseClient,
  factureId: string,
): Promise<ValidationResult> {
  // Remettre statut brouillon pour que validerFacture ré-entre proprement
  await supabase
    .from('factures')
    .update({ statut: 'brouillon' })
    .eq('id', factureId);
  return validerFacture(supabase, factureId);
}

// Worker retry automatique — appelle renvoyerFacture pour les factures éligibles.
const RETRY_DELAYS: Record<string, number> = {
  retry_1: 5 * 60 * 1000,
  retry_2: 60 * 60 * 1000,
  retry_3: 24 * 60 * 60 * 1000,
};
const MAX_RETRY_STATUT = 'retry_3';

export interface PennylaneRetryResult {
  processed: number;
  emise: number;
  requeue: number;
  dlq: number;
  errors: string[];
}

export async function runPennylaneRetryWorker(
  supabase: SupabaseClient,
): Promise<PennylaneRetryResult> {
  const result: PennylaneRetryResult = {
    processed: 0,
    emise: 0,
    requeue: 0,
    dlq: 0,
    errors: [],
  };

  const now = new Date();

  // Sélectionner les factures en attente avec delai écoulé selon pennylane_statut
  const { data: factures } = await supabase
    .from('factures')
    .select('id, pennylane_statut, derniere_tentative_pennylane_at')
    .eq('statut', 'en_attente_pennylane')
    .in('pennylane_statut', ['retry_1', 'retry_2', 'retry_3'])
    .order('derniere_tentative_pennylane_at', { ascending: true })
    .limit(20);

  type RetryRow = {
    id: string;
    pennylane_statut: string;
    derniere_tentative_pennylane_at: string;
  };

  for (const row of (factures ?? []) as RetryRow[]) {
    const delay = RETRY_DELAYS[row.pennylane_statut] ?? 0;
    const lastAttempt = new Date(row.derniere_tentative_pennylane_at);
    if (now.getTime() - lastAttempt.getTime() < delay) continue;

    result.processed++;
    try {
      const res = await renvoyerFacture(supabase, row.id);

      if (res.statut === 'emise') {
        result.emise++;
      } else if (res.statut === 'en_attente_pennylane') {
        // Escalader le statut retry
        const nextStatut =
          row.pennylane_statut === MAX_RETRY_STATUT
            ? 'echec_final'
            : incrementRetry(row.pennylane_statut);

        await supabase
          .from('factures')
          .update({
            pennylane_statut: nextStatut,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);

        if (nextStatut === 'echec_final') {
          result.dlq++;
          await supabase.rpc('f_upsert_alerte_admin', {
            p_code: 'pennylane_echec_final',
            p_titre: 'Échec envoi Pennylane — intervention requise',
            p_message: `Facture ${row.id} : 3 tentatives Pennylane épuisées. Renvoyer manuellement.`,
            p_entity_type: 'factures',
            p_entity_id: row.id,
          });
        } else {
          result.requeue++;
        }
      }
    } catch (err) {
      result.errors.push(`facture ${row.id}: ${String(err)}`);
    }
  }

  return result;
}

function incrementRetry(statut: string): string {
  if (statut === 'retry_1') return 'retry_2';
  if (statut === 'retry_2') return 'retry_3';
  return 'echec_final';
}
