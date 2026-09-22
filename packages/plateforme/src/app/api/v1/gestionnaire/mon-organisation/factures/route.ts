import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/mon-organisation/factures
// Factures de la propre organisation (F6 — miroir shared.fichiers, self-only).
// Pas d'accès aux factures d'autres organisations. Brouillons exclus
// (arbitrage Val 2026-09-18, idem route traiteur/factures) — §06.04 l.708 dit
// « toutes les factures », cf. _Divergences M3.2_20260918.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

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
       pdf_url_savr, pdf_url_pennylane, facture_origine_id,
       factures_collectes(
         collectes!collecte_id(id, date_collecte, type,
           evenements!inner(nom_evenement, date_evenement,
             lieux!lieu_id(nom)))
       )`,
    )
    .neq('statut', 'brouillon')
    .order('date_emission', { ascending: false, nullsFirst: false });

  if (statut) q = q.eq('statut', statut);
  if (from) q = q.gte('date_emission', from);
  if (to) q = q.lte('date_emission', to);

  const { data, error } = await q;
  if (error)
    return serverError(error, 'gestionnaire.mon_organisation.factures.list');

  return NextResponse.json({ data: data ?? [] });
}
