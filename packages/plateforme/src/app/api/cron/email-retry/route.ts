// Cron Vercel — retry automatique des emails Resend en échec (R10b · BL-P1-API-05).
// Déclenché toutes les 5 min (vercel.json). Paliers : 5 min / 1h / 24h (tentative 2-4),
// dérivés de emails_envoyes.created_at. Échec final → statut='failed' + integrations_logs.
//
// Le worker (module partagé) tranche le sort des lignes ; les suites métier sont
// tirées ici (décision Val 2026-10-08) :
//   · email abandonné après la 4e tentative → alerte in-app Admin (§08 §6) ; pour
//     les infos d'accès chauffeur, la collecte revient en plus « à envoyer » ;
//   · email d'infos d'accès finalement parti → son alerte est close ;
//   · email d'infos d'accès encore en reprise avant une collecte proche → alerte
//     anticipée, sans attendre les 25 h de l'échec définitif.

import { runEmailRetryWorker } from '@savr/shared/src/email/index.js';
import { logger } from '@savr/shared/src/logger/index.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';
import { traiterEmailPerdu } from '@/lib/emails/email-perdu.js';
import {
  TEMPLATE_INFOS_ACCES,
  alerterInfosAccesEnRepriseAvantCollecte,
  cloreAlerteInfosAcces,
} from '@/lib/infos-acces/suivi-email.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Non catalogué §07/02 → pas d'alerte Slack sur simple crash (job.cron.failed loggé).
export const POST = withCronObservability(
  'email_retry',
  async ({ supabase }) => {
    const { reussis, epuises, ...compteurs } =
      await runEmailRetryWorker(supabase);

    // Une suite manquée n'interrompt pas les autres : chacune est journalisée
    // (sans adresse) et comptée dans `errors`, que le wrapper remonte.
    const errors: string[] = [];
    const noter = (
      etape: string,
      emailId: string | null,
      erreur: { code?: string } | null,
    ): void => {
      if (!erreur) return;
      const error_code = erreur.code ?? 'UNKNOWN';
      logger.error('email.suite_echec_non_appliquee', {
        etape,
        email_id: emailId,
        error_code,
      });
      errors.push(`${etape}:${error_code}`);
    };

    for (const email of epuises) {
      noter(
        'email_perdu',
        email.id,
        await traiterEmailPerdu(supabase, email, 'tentatives_epuisees'),
      );
    }

    for (const email of reussis) {
      if (
        email.template_code === TEMPLATE_INFOS_ACCES &&
        email.entity_type === 'collecte' &&
        email.entity_id
      ) {
        noter(
          'alerte_close',
          email.id,
          await cloreAlerteInfosAcces(supabase, email.entity_id),
        );
      }
    }

    const anticipee = await alerterInfosAccesEnRepriseAvantCollecte(supabase);
    noter('alerte_anticipee', null, anticipee.error);

    // Les lignes tranchées portent des adresses : seuls les compteurs sortent.
    return {
      ...compteurs,
      infos_acces_signalees: anticipee.signalees,
      errors,
    };
  },
);

// Vercel Cron invoque en GET (avec `Authorization: Bearer $CRON_SECRET`) ; POST reste
// accepté pour les déclenchements manuels. Même handler, même garde fail-closed.
export const GET = POST;
