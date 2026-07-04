import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  CHIP_KEYS,
  applyChipPredicate,
  type ChipQuery,
} from '@/lib/collectes-chips.js';

// GET /api/v1/admin/collectes/chip-counts
// Compteur par chip prédéfini (§06.06 §3) pour les pastilles de la liste. Un
// count-only (head:true) par chip, prédicats partagés avec la liste (source
// unique = lib/collectes-chips) → jamais de divergence compteur/filtre.
export async function GET(req: NextRequest): Promise<NextResponse> {
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
    return NextResponse.json(Object.fromEntries(entries));
  } catch (err) {
    return serverError(err, 'admin.collectes.chip_counts');
  }
}
