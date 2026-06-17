import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/mon-organisation/factures
// Factures de la propre organisation (F6 — miroir shared.fichiers, self-only).
// Pas d'accès aux factures d'autres organisations.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const statut = sp.get('statut');
  const from = sp.get('from');
  const to = sp.get('to');

  let q = supabase
    .from('factures')
    .select(
      `id, numero_facture, statut, date_emission, date_echeance,
       montant_ht, montant_tva, montant_ttc, devise,
       pdf_url, avoir_facture_id,
       factures_collectes(
         collectes!collecte_id(id, date_collecte, type,
           evenements!inner(nom_evenement, date_evenement,
             lieux!lieu_id(nom)))
       )`,
    )
    .order('date_emission', { ascending: false });

  if (statut) q = q.eq('statut', statut);
  if (from) q = q.gte('date_emission', from);
  if (to) q = q.lte('date_emission', to);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
