// Cron Vercel — polling entrant MTS-1 (M1.5b).
// Appelé toutes les 15 min 24/7 (vercel.json : crons).
// Auth : header Authorization Bearer == CRON_SECRET (Vercel injecte automatiquement).

import {
  getLogistiqueProvider,
  type FenetreSync,
  type TypeTms,
} from '@savr/adapters/src/index.js';

import { withCronObservability } from '@/lib/cron-observabilite.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// §07/02 mts1_polling = criticité élevée → §07/03 « Job cron critique échoué » =
// canal eleve. Une erreur sur ≥1 transporteur fait échouer le run (throw → 500 +
// alerte eleve agrégée), conforme au comportement 500-si-erreurs historique.
export const POST = withCronObservability(
  'mts1_polling',
  async ({ supabase }) => {
    // Fenêtre glissante : now-2h → now+48h (corrections tardives + collectes futures)
    const maintenant = new Date();
    const fenetre: FenetreSync = {
      depuis: new Date(maintenant.getTime() - 2 * 60 * 60 * 1000),
      jusqu_a: new Date(maintenant.getTime() + 48 * 60 * 60 * 1000),
    };

    const { data: transporteurs } = await supabase
      .from('transporteurs')
      .select(
        'id, type_tms, code_transporteur_mts1, prestataire_logistique_id',
      );

    if (!transporteurs?.length) {
      return { synced: 0, nb_traite: 0 };
    }

    let synced = 0;
    const errors: string[] = [];

    for (const t of transporteurs) {
      try {
        const provider = getLogistiqueProvider(
          {
            id: t.id as string,
            type_tms: t.type_tms as TypeTms,
            code_transporteur_mts1: t.code_transporteur_mts1 as string | null,
            prestataire_logistique_id: t.prestataire_logistique_id as string,
          },
          supabase,
        );
        await provider.sync(fenetre);
        synced++;
      } catch (err) {
        // Détail par transporteur agrégé dans l'Error levée ci-dessous (→
        // job.cron.failed + alerte eleve). Le business-event de polling entrant
        // appartient à l'adapter (packages/adapters), pas au shell cron (garde-fou 3).
        errors.push(`${String(t.id)}: ${String(err)}`);
      }
    }

    if (errors.length > 0) {
      // Échec du job critique → job.cron.failed + alerte eleve agrégée (§07/03) + 500.
      throw new Error(
        `polling MTS-1 : ${errors.length} transporteur(s) en échec — ${errors.join('; ')}`,
      );
    }
    return { synced, nb_traite: synced };
  },
  { canalOnFailure: 'eleve' },
);
