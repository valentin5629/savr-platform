import { NextRequest, NextResponse } from 'next/server';
import { csvFilename } from '@savr/shared/src/csv/index.js';
import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { csvResponse } from '@/lib/csv.js';
import {
  EVENEMENTS_SELECT,
  evenementsToCsv,
} from '@/lib/exports/evenements.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/evenements/export-csv
// Export CSV grain événement (§06.05 §2 / §12 §2). Périmètre gestionnaire =
// ses lieux (organisations_lieux) + filtre lieu_ids[] optionnel. Le mapping et
// le format CSV sont factorisés dans le module partagé lib/exports/evenements
// (transverse D) — colonnes figées §12 §2, dates/poids au format canonique.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuIds = sp.getAll('lieu_ids[]');

  // Périmètre lieux du gestionnaire (défense en profondeur — la RLS
  // evt_gestionnaire_select scope déjà sur organisations_lieux).
  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const perimetreLieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  const lieuFilter =
    lieuIds.length > 0
      ? lieuIds.filter((id) => perimetreLieuIds.includes(id))
      : perimetreLieuIds;

  if (lieuFilter.length === 0) {
    const csv = await evenementsToCsv(supabase, []);
    return csvResponse(csvFilename('evenements', new Date()), csv);
  }

  let q = supabase
    .from('evenements')
    .select(EVENEMENTS_SELECT)
    .in('lieu_id', lieuFilter)
    .order('date_evenement', { ascending: false });

  if (from) q = q.gte('date_evenement', from);
  if (to) q = q.lte('date_evenement', to);

  const { data: evts, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const csv = await evenementsToCsv(
    supabase,
    (evts ?? []) as Record<string, unknown>[],
  );
  return csvResponse(csvFilename('evenements', new Date()), csv);
}
