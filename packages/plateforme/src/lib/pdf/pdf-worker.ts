// Worker PDF — pattern claim/process/result (similaire au worker outbox M1.5a).
// Retry toutes les 15 min jusqu'à 4h (≈16 tentatives), puis dead → alerte Admin.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { generatePdf } from './railway-client.js';
import { uploadPdf, type R2Bucket } from './r2-client.js';

const MAX_ATTEMPTS = 16;
const RETRY_INTERVAL_MS = 15 * 60 * 1000;

interface JobRow {
  id: string;
  type_document: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface PdfWorkerResult {
  processed: number;
  done: number;
  dead: number;
  errors: string[];
}

export async function runPdfWorker(
  supabase: SupabaseClient,
): Promise<PdfWorkerResult> {
  const result: PdfWorkerResult = {
    processed: 0,
    done: 0,
    dead: 0,
    errors: [],
  };

  // Claim jusqu'à 5 jobs pending/retrying dont la prochaine tentative est passée
  const { data: jobs, error: claimErr } = await supabase
    .from('jobs_pdf')
    .select('id, type_document, entity_type, entity_id, payload, attempts')
    .in('statut', ['pending', 'failed', 'retrying'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(5);

  if (claimErr || !jobs?.length) return result;

  for (const job of jobs as JobRow[]) {
    result.processed++;

    // Marquer processing
    await supabase
      .from('jobs_pdf')
      .update({ statut: 'processing', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('statut', ['pending', 'retrying'] as unknown as string); // optimistic

    try {
      const pdfType = job.type_document as
        | 'bordereau-zd'
        | 'rapport-recyclage-zd'
        | 'attestation-don';
      const { pdfBuffer } = await generatePdf(pdfType, job.payload);

      const bucket: R2Bucket =
        job.type_document === 'bordereau-zd' ? 'bordereaux' : 'rapports';
      const key = `${job.entity_id}/${job.type_document}-v${job.attempts + 1}-${Date.now()}.pdf`;
      const storageKey = await uploadPdf(bucket, key, pdfBuffer);

      // Insérer dans shared.fichiers
      const { data: fichierRow } = await supabase
        .schema('shared')
        .from('fichiers')
        .insert({
          entity_type: `plateforme.${job.entity_type}`,
          entity_id: job.entity_id,
          nom: `${job.type_document}.pdf`,
          mime_type: 'application/pdf',
          url: storageKey,
          taille_octets: pdfBuffer.length,
        })
        .select('id')
        .single();

      // Mettre à jour le job
      await supabase
        .from('jobs_pdf')
        .update({
          statut: 'done',
          fichier_id: fichierRow?.id ?? null,
          attempts: job.attempts + 1,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      // Mettre à jour l'entité cible avec le fichier_id (et storageKey pour rapports_rse)
      await linkFichierToEntity(
        supabase,
        job.entity_type,
        job.entity_id,
        fichierRow?.id,
        storageKey,
      );

      result.done++;
    } catch (err) {
      const newAttempts = job.attempts + 1;
      const isDead = newAttempts >= MAX_ATTEMPTS;

      await supabase
        .from('jobs_pdf')
        .update({
          statut: isDead ? 'dead' : 'failed',
          attempts: newAttempts,
          next_retry_at: isDead
            ? null
            : new Date(Date.now() + RETRY_INTERVAL_MS).toISOString(),
          last_error: String(err),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      if (isDead) {
        result.dead++;
        // Alerte Admin in-app via la fonction SQL dédupliquée
        await supabase.rpc('f_upsert_alerte_admin', {
          p_code: 'pdf_job_dead',
          p_titre: 'Échec génération PDF',
          p_message: `Job PDF ${job.type_document} définitivement échoué après ${newAttempts} tentatives.`,
          p_entity_type: job.entity_type,
          p_entity_id: job.entity_id,
        });
      }

      result.errors.push(`job ${job.id}: ${String(err)}`);
    }
  }

  return result;
}

async function linkFichierToEntity(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string,
  fichierId: string | undefined,
  storageKey: string,
): Promise<void> {
  if (!fichierId) return;

  if (entityType === 'bordereaux_savr') {
    await supabase
      .from('bordereaux_savr')
      .update({
        pdf_fichier_id: fichierId,
        statut: 'emis',
        genere_at: new Date().toISOString(),
      })
      .eq('id', entityId);
  } else if (entityType === 'rapports_rse') {
    await supabase
      .from('rapports_rse')
      .update({ pdf_url: storageKey, genere_at: new Date().toISOString() })
      .eq('id', entityId);
  } else if (entityType === 'attestations_don') {
    await supabase
      .from('attestations_don')
      .update({
        pdf_url: storageKey,
        statut: 'emise',
        genere_at: new Date().toISOString(),
      })
      .eq('id', entityId);
  }
}
