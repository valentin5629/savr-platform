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

/** Recul de la fenêtre de relève : 3 jours (décision Val 2026-10-13). */
const RECUL_RELEVE_MS = 3 * 24 * 60 * 60 * 1000;

// §07/02 mts1_polling = criticité élevée → §07/03 « Job cron critique échoué » =
// canal eleve. Une relève en échec (une par type de prestataire) fait échouer le
// run (throw → 500 + alerte eleve agrégée), conforme au comportement
// 500-si-erreurs historique.
export const POST = withCronObservability(
  'mts1_polling',
  async ({ supabase }) => {
    // Fenêtre glissante : maintenant − 3 jours → maintenant + 48 h (décision Val
    // 2026-10-13). La recherche MTS-1 compare des JOURS entiers : avec 2 h de
    // recul, une commande du jour J n'était plus demandée après 2 h du matin à
    // J+1, alors que les collectes ont lieu de nuit. Trois jours laissent aussi
    // voir une pesée corrigée ou une photo arrivée après la fin du tour.
    // ⚠ Les réservations de statut et les signaux « une fois » de la relève vivent
    // dans integrations_inbox, purgée à 7 jours : la fenêtre (recul + avance, en
    // jours de commande) doit rester plus courte, sinon des statuts sont rejoués
    // et des alertes réémises.
    const maintenant = new Date();
    const fenetre: FenetreSync = {
      depuis: new Date(maintenant.getTime() - RECUL_RELEVE_MS),
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
    // Une relève par type de prestataire, pas par transporteur : MTS-1 est UN
    // compte (une clé), dont la relève lit toutes les commandes quel que soit le
    // transporteur. La rejouer pour chaque transporteur relisait chaque tour
    // autant de fois, sans rien apporter.
    const typesReleves = new Set<TypeTms>();

    for (const t of transporteurs) {
      const typeTms = t.type_tms as TypeTms;
      if (typesReleves.has(typeTms)) continue;
      typesReleves.add(typeTms);
      try {
        const provider = getLogistiqueProvider(
          {
            id: t.id as string,
            type_tms: typeTms,
            code_transporteur_mts1: t.code_transporteur_mts1 as string | null,
            prestataire_logistique_id: t.prestataire_logistique_id as string,
          },
          supabase,
        );
        await provider.sync(fenetre);
        synced++;
      } catch (err) {
        // Détail par type de prestataire agrégé dans l'Error levée ci-dessous (→
        // job.cron.failed + alerte eleve). Le business-event de polling entrant
        // appartient à l'adapter (packages/adapters), pas au shell cron (garde-fou 3).
        errors.push(`relève ${typeTms}: ${String(err)}`);
      }
    }

    if (errors.length > 0) {
      // Échec du job critique → job.cron.failed + alerte eleve agrégée (§07/03) + 500.
      throw new Error(
        `polling MTS-1 : ${errors.length} relève(s) en échec — ${errors.join('; ')}`,
      );
    }
    return { synced, nb_traite: synced };
  },
  { canalOnFailure: 'eleve' },
);

// Vercel Cron invoque en GET (avec `Authorization: Bearer $CRON_SECRET`) ; POST reste
// accepté pour les déclenchements manuels. Même handler, même garde fail-closed.
export const GET = POST;
