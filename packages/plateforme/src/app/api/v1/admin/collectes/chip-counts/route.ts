import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';
import {
  CHIP_KEYS,
  applyChipPredicate,
  type ChipKey,
  type ChipQuery,
} from '@/lib/collectes-chips.js';
import { jourParis } from '@savr/shared/src/temps/index.js';

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

    // KPI « à dispatcher » par type (tuiles de tête) = définition canonique
    // §11 §1.1 (Val 2026-09-14), soit exactement le chip « Non transmises
    // ZD/AG ». La tuile reprend le compteur du chip : ni requête ni prédicat
    // propres, donc tuile et chip ne peuvent pas diverger.
    const compteurs = Object.fromEntries(entries) as Record<ChipKey, number>;

    // KPI de tête files d'action (refonte 2026-07-15, décision Val) :
    // définitions DATE-BASED → `date_collecte >= aujourd'hui`, quel que soit le
    // statut. Tuiles « AG / ZD à venir » retirées (décision Val 2026-10-01).
    // « Infos accès à envoyer » = contrôle d'accès requis ET aucun envoi de
    // l'email récap réservé (module infos accès chauffeur, décision Val
    // 2026-07-15). `infos_acces_email_envoye_at` est posé AVANT l'envoi : la
    // collecte sort du compteur dès qu'un envoi est réservé, et y revient si
    // l'email est perdu (tampon retiré — lib/infos-acces/suivi-email.ts).
    // « Infos à récupérer » = infos traiteur incomplètes. Le filtre liste
    // `controle_acces` DOIT matcher exactement cette définition (route.ts) —
    // brouillons exclus comme dans la liste, qui ne les sert jamais (décision
    // Val 2026-10-07) : sinon la tuile compterait des collectes introuvables.
    const today = jourParis(now);
    const countAvenirFlag = async (
      col: 'controle_acces_requis' | 'informations_completes',
      val: boolean,
    ): Promise<number> => {
      const { count, error } = await supabase
        .from('collectes')
        .select('id', { count: 'exact', head: true })
        .eq(col, val)
        .neq('statut', 'brouillon')
        .gte('date_collecte', today);
      if (error) throw error;
      return count ?? 0;
    };
    // « Infos accès à envoyer » : requis ET non encore envoyé ET à venir.
    const countControleAccesAEnvoyer = async (): Promise<number> => {
      const { count, error } = await supabase
        .from('collectes')
        .select('id', { count: 'exact', head: true })
        .eq('controle_acces_requis', true)
        .is('infos_acces_email_envoye_at', null)
        .neq('statut', 'brouillon')
        .gte('date_collecte', today);
      if (error) throw error;
      return count ?? 0;
    };
    const [controle_acces_a_envoyer, infos_a_recuperer] = await Promise.all([
      countControleAccesAEnvoyer(),
      countAvenirFlag('informations_completes', false),
    ]);

    return NextResponse.json({
      ...compteurs,
      ag_a_dispatcher: compteurs.non_transmises_ag,
      zd_a_dispatcher: compteurs.non_transmises_zd,
      controle_acces_a_envoyer,
      infos_a_recuperer,
    });
  } catch (err) {
    return serverError(err, 'admin.collectes.chip_counts');
  }
}

export const GET = withApiTrace(getHandler);
