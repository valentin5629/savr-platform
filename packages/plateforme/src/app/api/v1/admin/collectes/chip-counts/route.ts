import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';
import {
  CHIP_KEYS,
  applyChipPredicate,
  type ChipQuery,
} from '@/lib/collectes-chips.js';

// GET /api/v1/admin/collectes/chip-counts
// Compteur par chip prédéfini (§06.06 §3) pour les pastilles de la liste. Un
// count-only (head:true) par chip, prédicats partagés avec la liste (source
// unique = lib/collectes-chips) → jamais de divergence compteur/filtre.
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const now = new Date();

  try {
    const entries = await Promise.all(
      CHIP_KEYS.map(async (chip) => {
        // L'embed attributions_antgaspi est requis par l'anti-jointure du chip
        // « ag_attente_attribution » (.is(relation, null)) ; inoffensif ailleurs.
        const base = supabase
          .from('collectes')
          .select('id, attributions_antgaspi!collecte_id(id)', {
            count: 'exact',
            head: true,
          });
        const { count, error } = await (applyChipPredicate(
          base as unknown as ChipQuery,
          chip,
          now,
        ) as unknown as typeof base);
        if (error) throw error;
        return [chip, count ?? 0] as const;
      }),
    );

    // KPI « à dispatcher » par type (tuiles de tête, refonte UI Collectes) =
    // programmée ET non transmise au TMS (même prédicat que le chip
    // `non_transmises`, scindé AG / ZD). Définition à confirmer avec Val.
    const dispatchByType = async (t: string): Promise<number> => {
      const { count, error } = await supabase
        .from('collectes')
        .select('id', { count: 'exact', head: true })
        .eq('type', t)
        .eq('statut', 'programmee')
        .is('tms_reference', null);
      if (error) throw error;
      return count ?? 0;
    };
    const [ag_a_dispatcher, zd_a_dispatcher] = await Promise.all([
      dispatchByType('anti_gaspi'),
      dispatchByType('zero_dechet'),
    ]);

    // KPI de tête « à venir » / files d'action (refonte 2026-07-15, décision Val) :
    // définitions DATE-BASED → `date_collecte >= aujourd'hui`, quel que soit le
    // statut. AG/ZD à venir = volume par type. « Plaques à envoyer » = contrôle
    // d'accès requis (le suivi d'envoi de plaque au lieu est hors périmètre V1,
    // cf. `email_plaque_envoye_at` supprimé → proxy = tout accès requis).
    // « Infos à récupérer » = infos traiteur incomplètes.
    const today = now.toISOString().slice(0, 10);
    const countAvenirType = async (t: string): Promise<number> => {
      const { count, error } = await supabase
        .from('collectes')
        .select('id', { count: 'exact', head: true })
        .eq('type', t)
        .gte('date_collecte', today);
      if (error) throw error;
      return count ?? 0;
    };
    const countAvenirFlag = async (
      col: 'controle_acces_requis' | 'informations_completes',
      val: boolean,
    ): Promise<number> => {
      const { count, error } = await supabase
        .from('collectes')
        .select('id', { count: 'exact', head: true })
        .eq(col, val)
        .gte('date_collecte', today);
      if (error) throw error;
      return count ?? 0;
    };
    const [
      ag_a_venir,
      zd_a_venir,
      controle_acces_a_envoyer,
      infos_a_recuperer,
    ] = await Promise.all([
      countAvenirType('anti_gaspi'),
      countAvenirType('zero_dechet'),
      countAvenirFlag('controle_acces_requis', true),
      countAvenirFlag('informations_completes', false),
    ]);

    return NextResponse.json({
      ...Object.fromEntries(entries),
      ag_a_dispatcher,
      zd_a_dispatcher,
      ag_a_venir,
      zd_a_venir,
      controle_acces_a_envoyer,
      infos_a_recuperer,
    });
  } catch (err) {
    return serverError(err, 'admin.collectes.chip_counts');
  }
}

export const GET = withApiTrace(getHandler);
