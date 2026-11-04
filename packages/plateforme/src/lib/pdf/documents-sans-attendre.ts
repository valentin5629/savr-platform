// Documents d'une collecte fabriqués juste après une saisie de poids par l'Admin
// (Val 2026-11-04), sans attendre le passage planifié (toutes les 15 min, en
// production seulement) : bordereau émis ou refait (ZD), attestation émise (AG,
// sa correction est mise en file par trg_regenerer_attestation), puis rendu des
// PDF de cette collecte seule.
//
// Ce passage n'est pas une garantie : s'il échoue, le passage planifié reprend.
// La route qui l'appelle exporte `maxDuration = 60` (rendus PDF compris).

import { after } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { runBatchPdfJ1 } from './batch-pdf-j1.js';
import { runBatchPdfJ1Ag } from './batch-pdf-j1-ag.js';
import { runPdfWorker } from './pdf-worker.js';
import { erreurInterne } from '@/lib/api-helpers.js';

type ClientService = ReturnType<typeof createAdminSupabaseClient>;

export function fabriquerDocumentsSansAttendre(
  collecteId: string,
  type: 'zero_dechet' | 'anti_gaspi',
): void {
  try {
    after(async () => {
      try {
        await fabriquer(createAdminSupabaseClient(), collecteId, type);
      } catch (err) {
        logger.error('pdf.documents_sans_attendre.echec', {
          collecte_id: collecteId,
          error: String(err),
        });
      }
    });
  } catch (err) {
    // `after()` lève hors requête : la saisie a réussi, le passage planifié
    // fabriquera les documents.
    logger.error('pdf.documents_sans_attendre.non_programme', {
      collecte_id: collecteId,
      error: String(err),
    });
  }
}

export async function fabriquer(
  supabase: ClientService,
  collecteId: string,
  type: 'zero_dechet' | 'anti_gaspi',
): Promise<void> {
  const table = type === 'zero_dechet' ? 'bordereaux_savr' : 'attestations_don';

  const batch =
    type === 'zero_dechet'
      ? await runBatchPdfJ1(supabase, { collecteId })
      : await runBatchPdfJ1Ag(supabase, { collecteId });
  if (batch.fatal || batch.errors.length) {
    logger.error('pdf.documents_sans_attendre.batch', {
      collecte_id: collecteId,
      erreurs: batch.errors.length,
    });
  }

  const { data: documents, error } = await supabase
    .from(table)
    .select('id')
    .eq('collecte_id', collecteId);
  if (error) throw erreurInterne(error, 'pdf.documents_sans_attendre.lecture');
  const entityIds = (documents ?? []).map((d: { id: string }) => d.id);

  // Un seul passage du rendu (jusqu'à 5 rendus, une collecte en a 1 ou 2) :
  // la tâche reste sous la borne de 60 s de la route. Le reste, s'il y en a,
  // part au passage planifié du rendu (toutes les 5 min).
  await runPdfWorker(supabase, { entityIds });
}
