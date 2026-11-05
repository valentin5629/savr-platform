// Cron Vercel — clôture automatique realisee → cloturee à realisee_at + 48 h, puis
// email « document disponible » des collectes clôturées dont le document existe
// (Val 2026-11-04 : les documents sortent dès que les poids sont là, le client
// n'est prévenu qu'à 48 h). Déclenché toutes les heures (vercel.json).

import { logger } from '@savr/shared/src/logger/index.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';
import { envoyerEmailsDocumentsDisponibles } from '@/lib/pdf/emails-documents-disponibles.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = withCronObservability(
  'cloture_embargo',
  async ({
    supabase,
  }): Promise<{ nb_traite: number; emails_envoyes: number }> => {
    const { data, error } = await supabase.rpc('fn_cloturer_collectes_embargo');
    if (error)
      throw new Error(`fn_cloturer_collectes_embargo: ${error.message}`);
    // Après la clôture : une collecte clôturée à l'instant reçoit son email
    // dans le même passage. Un email raté n'annule pas la clôture.
    const emails = await envoyerEmailsDocumentsDisponibles(supabase);
    if (emails.errors.length) {
      logger.warn('cloture_embargo.emails_en_echec', {
        nb_errors: emails.errors.length,
        premiere: emails.errors[0],
      });
    }
    return {
      nb_traite: (data as number | null) ?? 0,
      emails_envoyes: emails.envoyes,
    };
  },
);

// Vercel Cron invoque en GET (avec `Authorization: Bearer $CRON_SECRET`) ; POST reste
// accepté pour les déclenchements manuels. Même handler, même garde fail-closed.
export const GET = POST;
