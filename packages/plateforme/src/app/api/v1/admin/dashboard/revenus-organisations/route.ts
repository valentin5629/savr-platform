import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  // Revenus = sum montant_ht des factures emises/payees, imputées à l'organisation
  // programmatrice (evenements.organisation_id), filtrées par date_collecte
  // Le statut est porté par `factures` (pas `factures_collectes`). Revenu =
  // factures emises + payees, càd hors brouillon/en_attente_pennylane et hors annulee.
  // G1 cluster B.2 : les ex-statuts envoyee/en_retard ont convergé vers `emise`
  // (le « retard » est désormais dérivé de date_echeance, plus un statut stocké).
  let query = supabase
    .from('factures_collectes')
    .select(
      `montant_ht,
       factures!inner(statut),
       collectes!inner(
         date_collecte,
         evenements!inner(
           organisation_id,
           organisations!organisation_id(id, raison_sociale)
         )
       )`,
      { count: 'exact' },
    )
    .in('factures.statut', ['emise', 'payee'])
    .range(offset, offset + limit - 1);

  if (from) query = query.gte('collectes.date_collecte', from);
  if (to) query = query.lte('collectes.date_collecte', to);

  const { data, error, count } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrégation par organisation
  const byOrg = new Map<
    string,
    { organisation_id: string; raison_sociale: string; total_ht: number }
  >();

  for (const row of data ?? []) {
    const r = row as unknown as {
      montant_ht: number;
      collectes: {
        evenements: {
          organisation_id: string;
          organisations: { id: string; raison_sociale: string };
        };
      };
    };
    const orgId = r.collectes.evenements.organisation_id;
    const orgName = r.collectes.evenements.organisations.raison_sociale;
    const existing = byOrg.get(orgId);
    if (existing) {
      existing.total_ht += r.montant_ht;
    } else {
      byOrg.set(orgId, {
        organisation_id: orgId,
        raison_sociale: orgName,
        total_ht: r.montant_ht,
      });
    }
  }

  const rows = Array.from(byOrg.values()).sort(
    (a, b) => b.total_ht - a.total_ht,
  );

  return NextResponse.json({ data: rows, total: count ?? 0 });
}
