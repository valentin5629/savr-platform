// Envoi immédiat des ordres d'une collecte au prestataire (décision Val 2026-10-12).
//
// La mutation métier vient d'écrire l'ordre dans la file (`outbox_events`, même
// transaction — garde-fou 4). Plutôt que d'attendre le passage planifié (toutes
// les 15 min, en production seulement), on traite les ordres de CETTE collecte
// juste après la réponse HTTP : le clic n'attend pas le prestataire, et un
// prestataire lent ou en panne ne fait jamais échouer la requête.
//
// Ce passage n'est pas une garantie : s'il échoue ou ne trouve pas l'ordre,
// l'ordre reste en file et le passage planifié l'envoie (reprises comprises).
//
// ⚠ `envoyerOrdresSansAttendre` et `envoyerOrdresEvenementSansAttendre` ne
// s'appellent que depuis une route, et cette route DOIT exporter
// `maxDuration = 60`, la moitié du bail de réservation
// (120 s). Cette limite ne borne pas seule la durée de vie du passage : rien ne
// l'applique sur un serveur local, et sur Vercel une tâche `after()` hors délai
// a continué de s'exécuter quand une autre invocation occupait son processus
// (mesuré le 2026-10-12 — invariant A3, packages/adapters/src/outbox-worker.ts).
// Cliquet : tests/api/admin/envoi-immediat-routes.test.ts.
//
// Toute route qui appelle une fonction SQL émettrice d'ordres de collecte doit
// déclencher cet envoi après sa mutation réussie (cliquet de complétude, même
// fichier de tests). L'ordre « lieu » (E5) reste au passage planifié.

import { after } from 'next/server';

import { runOutboxWorkerPourCollecte } from '@savr/adapters/src/outbox-worker.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { erreurInterne } from '@/lib/api-helpers.js';

type ClientService = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Programme, pour après la réponse, l'envoi des ordres en file d'une collecte,
 * ou de plusieurs (une programmation en crée plusieurs d'un coup).
 * À appeler une fois la mutation émettrice réussie — jamais avant.
 */
export function envoyerOrdresSansAttendre(
  collecteIds: string | readonly string[],
): void {
  const ids = [
    ...new Set(typeof collecteIds === 'string' ? [collecteIds] : collecteIds),
  ];
  if (ids.length === 0) return;
  programmer({ collecte_ids: ids }, (supabase) => traiter(supabase, ids));
}

/**
 * Même chose pour toutes les collectes d'un événement : sa modification écrit
 * un ordre par collecte déjà commandée. Les collectes sont lues dans la tâche,
 * après la réponse — rien n'est ajouté au chemin de la requête.
 */
export function envoyerOrdresEvenementSansAttendre(evenementId: string): void {
  programmer({ evenement_id: evenementId }, async (supabase) => {
    const { data, error } = await supabase
      .from('collectes')
      .select('id')
      .eq('evenement_id', evenementId);
    // Le message réel est journalisé par `erreurInterne` ; l'erreur relancée est
    // neutre (jamais un message de la base dans une `Error` d'un module de route).
    if (error) {
      throw erreurInterne(
        error,
        'outbox.envoi_immediat.lecture_collectes_evenement',
      );
    }
    await traiter(
      supabase,
      ((data as { id: string }[] | null) ?? []).map((c) => c.id),
    );
  });
}

// Une collecte après l'autre, dans une seule tâche : une requête ne lance jamais
// deux passages à la fois chez le prestataire. L'échec d'une collecte n'empêche
// pas les suivantes ; son ordre reste en file pour le passage planifié.
async function traiter(
  supabase: ClientService,
  collecteIds: readonly string[],
): Promise<void> {
  for (const collecteId of collecteIds) {
    try {
      const resultat = await runOutboxWorkerPourCollecte(supabase, collecteId);
      logger.info('outbox.envoi_immediat', {
        collecte_id: collecteId,
        ...resultat,
      });
    } catch (err) {
      logger.error('outbox.envoi_immediat.echec', {
        collecte_id: collecteId,
        error: String(err),
      });
    }
  }
}

function programmer(
  contexte: Record<string, unknown>,
  tache: (supabase: ClientService) => Promise<void>,
): void {
  try {
    after(async () => {
      try {
        await tache(createAdminSupabaseClient());
      } catch (err) {
        // Jamais d'exception hors de la tâche : la requête a déjà répondu, et
        // les ordres restent en file pour le passage planifié.
        logger.error('outbox.envoi_immediat.echec', {
          ...contexte,
          error: String(err),
        });
      }
    });
  } catch (err) {
    // `after()` lève quand elle ne peut pas programmer la tâche (hors requête,
    // hôte sans `waitUntil`). La mutation a réussi : la route doit répondre son
    // succès, pas un 500. Les ordres restent en file pour le passage planifié.
    logger.error('outbox.envoi_immediat.non_programme', {
      ...contexte,
      error: String(err),
    });
  }
}
