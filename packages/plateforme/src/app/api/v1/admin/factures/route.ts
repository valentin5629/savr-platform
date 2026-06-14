import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const url = new URL(req.url);
  const statut = url.searchParams.get('statut');
  const orgId = url.searchParams.get('organisation_id');
  const page = parseInt(url.searchParams.get('page') ?? '1', 10);
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('factures')
    .select(
      `id, numero_facture, type, mode_facturation, statut, pennylane_statut,
       montant_ht, taux_tva, montant_ttc, devise,
       date_emission, date_echeance, date_paiement,
       organisation_id, entite_facturation_id, pack_antgaspi_id,
       pennylane_id, pdf_url_pennylane,
       erreur_synchro, erreur_synchro_at, derniere_tentative_pennylane_at,
       created_at, updated_at,
       organisations!organisation_id(raison_sociale),
       entites_facturation(raison_sociale, siret)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (statut) query = query.eq('statut', statut);
  if (orgId) query = query.eq('organisation_id', orgId);

  const { data, error, count } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, total: count, page, limit });
}
