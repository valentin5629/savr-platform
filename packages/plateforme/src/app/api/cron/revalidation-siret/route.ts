// Cron Vercel — revalidation SIRET des entités `en_attente` (R13 · BL-P1-ONB-02).
// Déclenché toutes les 15 min (vercel.json). Paliers : 15 min / 1h / 24h (CDC §15 §2.6 l.73).
// 'verifie'/'echec' → file 'resolu' ; 3 paliers down → file 'epuise' + alerte Admin in-app.

import { runSiretRevalidationWorker } from '@savr/shared/src/siret/revalidation.js';
import { ESPACES, ESPACE_PAR_ROLE, ONGLET_ORGANISATION } from '@/lib/routes';
import type { Role } from '@/lib/roles';
import { urlCanonique } from '@/lib/url-application.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Non catalogué §07/02 → pas d'alerte Slack ; INSEE down = alerte Admin in-app
// (dans le worker), pas Slack (anti-doublon §13 + chaîne API-tierce-HS séparée).
export const POST = withCronObservability(
  'siret_revalidation',
  async ({ supabase }) => {
    return await runSiretRevalidationWorker(supabase, undefined, (role) => {
      const espace = role ? ESPACE_PAR_ROLE[role as Role] : undefined;
      // L'équipe Savr n'a pas de page organisation. Côté client, l'organisation
      // est l'onglet « Organisation » de « Paramètres » (Val 2026-10-31).
      if (!espace || espace === 'admin') return null;
      return urlCanonique(
        `${ESPACES[espace].prefixe}/parametres?onglet=${ONGLET_ORGANISATION}`,
      );
    });
  },
);

// Vercel Cron invoque en GET (avec `Authorization: Bearer $CRON_SECRET`) ; POST reste
// accepté pour les déclenchements manuels. Même handler, même garde fail-closed.
export const GET = POST;
