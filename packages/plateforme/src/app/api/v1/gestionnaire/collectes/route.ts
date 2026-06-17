import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/collectes
// Liste des collectes sur les lieux du gestionnaire (vue v_collectes_gestionnaire_lieux).
// Paramètres : type, statut, from, to
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type');
  const statut = sp.get('statut');
  const from = sp.get('from');
  const to = sp.get('to');

  let q = supabase
    .from('v_collectes_gestionnaire_lieux')
    .select(
      `id, evenement_id, type, statut, statut_tms, date_collecte,
       heure_collecte, taux_recyclage, co2_evite_kg, realisee_at`,
    )
    .order('date_collecte', { ascending: false })
    .limit(100);

  if (type) q = q.eq('type', type);
  if (statut) q = q.eq('statut', statut);
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
