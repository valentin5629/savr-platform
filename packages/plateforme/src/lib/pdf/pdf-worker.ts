// Worker PDF — pattern claim/process/result (similaire au worker outbox M1.5a).
// Retry toutes les 15 min jusqu'à 4h (≈16 tentatives), puis dead → alerte Admin.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  TEMPLATE_VERSIONS,
  isPdfDocumentType,
  type PdfDocumentType,
} from '@savr/shared/src/pdf/document-types.js';
import { sendAlert } from '@savr/shared/src/alerting/slack.js';
import { logger } from '@savr/shared/src/logger/index.js';

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

  // Claim jusqu'à 5 jobs pending/failed dont la prochaine tentative est passée
  const { data: jobs, error: claimErr } = await supabase
    .from('jobs_pdf')
    .select('id, type_document, entity_type, entity_id, payload, attempts')
    .in('statut', ['pending', 'failed'])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .order('created_at', { ascending: true })
    .limit(5);

  if (claimErr || !jobs?.length) return result;

  for (const job of jobs as JobRow[]) {
    // M5 : claim ATOMIQUE. L'ancien `.eq('statut', [array])` passait un tableau à
    // un opérateur scalaire PostgREST → matchait 0 ligne, mais le code poursuivait
    // sans vérifier → deux crons chevauchants généraient 2× le même PDF (doc
    // fiscal en double, 2 uploads R2, 2 lignes shared.fichiers). On transitionne
    // pending/failed → processing et on ne traite QUE si une ligne a été
    // réellement verrouillée (RETURNING). Sinon, un run concurrent l'a déjà prise.
    const { data: claimed } = await supabase
      .from('jobs_pdf')
      .update({ statut: 'processing', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .in('statut', ['pending', 'failed'])
      .select('id');

    if (!claimed?.length) continue; // déjà claimé par un run concurrent → skip

    result.processed++;

    try {
      if (!isPdfDocumentType(job.type_document)) {
        throw new Error(`type_document inconnu : ${job.type_document}`);
      }
      const pdfType: PdfDocumentType = job.type_document;
      const { pdfBuffer } = await generatePdf(pdfType, job.payload);

      const bucket: R2Bucket =
        pdfType === 'bordereau-zd' ? 'bordereaux' : 'rapports';
      const key = `${job.entity_id}/${pdfType}-v${job.attempts + 1}-${Date.now()}.pdf`;
      const storageKey = await uploadPdf(bucket, key, pdfBuffer);

      // Insérer dans shared.fichiers (colonnes réelles : storage_provider/bucket/
      // key/content_type/size_bytes — cf. migration bloc1. L'ancien jeu nom/mime_type/
      // url/taille_octets n'existait pas → INSERT en échec runtime, fichier_id null,
      // PDF jamais lié à l'entité : column-db corrigé ici.)
      const { data: fichierRow } = await supabase
        .schema('shared')
        .from('fichiers')
        .insert({
          storage_provider: 'r2',
          bucket,
          key,
          content_type: 'application/pdf',
          size_bytes: pdfBuffer.length,
          entity_type: `plateforme.${job.entity_type}`,
          entity_id: job.entity_id,
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
      // + template_version figé (BL-P1-API-07 : re-rendu iso traçable).
      await linkFichierToEntity(
        supabase,
        job.entity_type,
        job.entity_id,
        fichierRow?.id,
        storageKey,
        TEMPLATE_VERSIONS[pdfType],
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
        // Alerte Admin in-app via la fonction SQL dédupliquée (worklist Ops)
        await supabase.rpc('f_upsert_alerte_admin', {
          p_code: 'pdf_job_dead',
          p_titre: 'Échec génération PDF',
          p_message: `Job PDF ${job.type_document} définitivement échoué après ${newAttempts} tentatives.`,
          p_entity_type: job.entity_type,
          p_entity_id: job.entity_id,
        });
        // §07/03 « PDF job en échec définitif » → push Slack eleve (chaîne technique,
        // distincte de la worklist in-app ci-dessus). Never throws.
        logger.error(
          'pdf.job_failed',
          {
            job_id: job.id,
            type_doc: job.type_document,
            entity_type: job.entity_type,
            entity_id: job.entity_id,
            retry_count: newAttempts,
          },
          { service: 'pdf' },
        );
        await sendAlert({
          canal: 'eleve',
          titre: 'PDF job en échec définitif',
          message: `Job PDF ${job.type_document} mort après ${newAttempts} tentatives (${job.entity_type}/${job.entity_id}).`,
          metadata: {
            job_id: job.id,
            type_document: job.type_document,
            entity_type: job.entity_type,
            entity_id: job.entity_id,
          },
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
  templateVersion: string,
): Promise<void> {
  if (!fichierId) return;

  if (entityType === 'bordereaux_savr') {
    await supabase
      .from('bordereaux_savr')
      .update({
        pdf_fichier_id: fichierId,
        template_version: templateVersion,
        statut: 'emis',
        genere_at: new Date().toISOString(),
      })
      .eq('id', entityId);
  } else if (entityType === 'rapports_rse') {
    await supabase
      .from('rapports_rse')
      .update({
        pdf_url: storageKey,
        template_version: templateVersion,
        genere_at: new Date().toISOString(),
      })
      .eq('id', entityId);
  } else if (entityType === 'attestations_don') {
    await supabase
      .from('attestations_don')
      .update({
        pdf_url: storageKey,
        template_version: templateVersion,
        statut: 'emise',
        genere_at: new Date().toISOString(),
      })
      .eq('id', entityId);
  }
}
