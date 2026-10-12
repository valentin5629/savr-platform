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
// ⚠ `envoyerOrdresSansAttendre` ne s'appelle que depuis une route, et cette
// route DOIT exporter `maxDuration = 60` : sur Vercel, c'est ce qui tient la
// durée de vie du passage sous le bail de réservation (120 s) — invariant A3,
// packages/adapters/src/outbox-worker.ts. Sur un serveur local, rien ne borne
// cette durée. Cliquet : tests/api/admin/envoi-immediat-routes.test.ts.

import { after } from 'next/server';

import { runOutboxWorkerPourCollecte } from '@savr/adapters/src/outbox-worker.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

/**
 * Programme, pour après la réponse, l'envoi des ordres en file de la collecte.
 * À appeler une fois la mutation émettrice réussie — jamais avant.
 */
export function envoyerOrdresSansAttendre(collecteId: string): void {
  try {
    after(async () => {
      try {
        const resultat = await runOutboxWorkerPourCollecte(
          createAdminSupabaseClient(),
          collecteId,
        );
        logger.info('outbox.envoi_immediat', {
          collecte_id: collecteId,
          ...resultat,
        });
      } catch (err) {
        // Jamais d'exception hors de la tâche : la requête a déjà répondu, et
        // l'ordre reste en file pour le passage planifié.
        logger.error('outbox.envoi_immediat.echec', {
          collecte_id: collecteId,
          error: String(err),
        });
      }
    });
  } catch (err) {
    // `after()` lève quand elle ne peut pas programmer la tâche (hors requête,
    // hôte sans `waitUntil`). La mutation a réussi : la route doit répondre son
    // succès, pas un 500. L'ordre reste en file pour le passage planifié.
    logger.error('outbox.envoi_immediat.non_programme', {
      collecte_id: collecteId,
      error: String(err),
    });
  }
}
