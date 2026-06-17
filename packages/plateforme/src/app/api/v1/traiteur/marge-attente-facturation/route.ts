import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// GET /api/v1/traiteur/marge-attente-facturation — badge F3 (§06.04 KPI Marge).
// Compte les collectes ZD cloturee du périmètre sans facture emise/payee rattachée.
// Affiché dès que X >= 1 (facturation partielle incluse).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  // Collectes ZD cloturee du périmètre (RLS scope l'orga)
  let q = supabase
    .from('collectes')
    .select(
      'id, date_collecte, factures_collectes(facture_id, factures(statut))',
    )
    .eq('type', 'zero_dechet')
    .eq('statut', 'cloturee');
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  type FactureLien = {
    factures: { statut: string } | { statut: string }[] | null;
  };
  const enAttente = (data ?? []).filter((c) => {
    const liens = (c.factures_collectes ?? []) as FactureLien[];
    const aFactureEmise = liens.some((l) => {
      const f = Array.isArray(l.factures) ? l.factures[0] : l.factures;
      return f?.statut === 'emise' || f?.statut === 'payee';
    });
    return !aFactureEmise;
  });

  return NextResponse.json({ data: { nb_en_attente: enAttente.length } });
}
