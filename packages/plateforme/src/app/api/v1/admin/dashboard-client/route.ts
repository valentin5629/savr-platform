import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import {
  computeDashboardKpi,
  emptyKpi,
  tailleBracket,
  type DashboardCollecteRow,
  type DashboardCollecteType,
} from '@/lib/dashboard-kpi.js';

// GET /api/v1/admin/dashboard-client
// §06.06 §2 — Dashboard Client : réplique LECTURE SEULE du dashboard gestionnaire
// (§06.05) pour l'équipe Savr, agrégé sur le périmètre d'organisations sélectionné.
//
// Spécificité Admin vs gestionnaire : aucun filtre RLS par lieux du périmètre.
// L'admin voit tout (service-role, bypass RLS). Le périmètre est piloté par le
// sélecteur d'organisations (evenements.organisation_id = organisation programmatrice) :
//   - organisation_ids[] vide  → « Toutes les organisations » = totalité des collectes Savr
//   - organisation_ids[] fourni → restreint au périmètre sélectionné
//
// Paramètres : type ('zero_dechet'|'anti_gaspi'), from, to, organisation_ids[],
//              lieu_ids[], traiteur_ids[], type_evenement_ids[], taille_evenements[]
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const sp = new URL(req.url).searchParams;
  const type = (sp.get('type') ?? 'zero_dechet') as DashboardCollecteType;
  const from = sp.get('from');
  const to = sp.get('to');
  const orgIds = sp.getAll('organisation_ids[]');
  const lieuIds = sp.getAll('lieu_ids[]');
  const traiteurIds = sp.getAll('traiteur_ids[]');
  const typeEvtIds = sp.getAll('type_evenement_ids[]');
  const tailleEvts = sp.getAll('taille_evenements[]');

  // Collectes cloturees (KPI = métriques réalisées, parité §06.05).
  let q = supabase
    .from('collectes')
    .select(
      `id, type, taux_recyclage, realisee_at,
       evenements!inner(id, organisation_id, lieu_id, pax, type_evenement_id,
         traiteur_operationnel_organisation_id),
       collecte_flux(poids_reel_kg),
       attributions_antgaspi(volume_repas_realise)`,
    )
    .eq('statut', 'cloturee')
    .eq('type', type);

  // « Toutes les organisations » = pas de filtre. Sinon périmètre sélectionné.
  if (orgIds.length > 0) q = q.in('evenements.organisation_id', orgIds);

  // Filtre de période sur date_collecte (NOT NULL), cohérent avec les vues KPI
  // M3.5 et la règle revenus §06.06 §1 — parité avec le dashboard gestionnaire
  // (§06.05). realisee_at (nullable) excluait à tort des collectes cloturées.
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);
  if (lieuIds.length > 0) q = q.in('evenements.lieu_id', lieuIds);
  if (traiteurIds.length > 0)
    q = q.in('evenements.traiteur_operationnel_organisation_id', traiteurIds);
  if (typeEvtIds.length > 0)
    q = q.in('evenements.type_evenement_id', typeEvtIds);

  const { data: collectes, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((collectes ?? []) as DashboardCollecteRow[]).filter((c) => {
    if (tailleEvts.length === 0) return true;
    const pax = Array.isArray(c.evenements)
      ? c.evenements[0]?.pax
      : c.evenements?.pax;
    return tailleEvts.includes(tailleBracket(pax ?? 0));
  });

  const kpi =
    rows.length > 0 ? computeDashboardKpi(rows, type) : emptyKpi(type);

  return NextResponse.json({ data: { kpi } });
}
