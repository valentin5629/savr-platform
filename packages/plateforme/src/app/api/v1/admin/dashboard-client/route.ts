import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import type { DashboardCollecteType } from '@/lib/dashboard-kpi.js';
import { loadAdminDashboardClient } from '@/lib/dashboards/admin-dashboard-client.js';

// GET /api/v1/admin/dashboard-client
// §06.06 §2 — Dashboard Client : réplique LECTURE SEULE du dashboard gestionnaire
// (§06.05) pour l'équipe Savr, agrégé sur le périmètre d'organisations sélectionné.
// R24c : renvoie désormais le dashboard COMPLET (KPI + kg/pax par flux + évolution
// + blocs top/prochaines), pour la déclinaison Cockpit full-graphes côté vue.
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

  try {
    const payload = await loadAdminDashboardClient(supabase, {
      type,
      from: sp.get('from'),
      to: sp.get('to'),
      organisationIds: sp.getAll('organisation_ids[]'),
      lieuIds: sp.getAll('lieu_ids[]'),
      traiteurIds: sp.getAll('traiteur_ids[]'),
      typeEvtIds: sp.getAll('type_evenement_ids[]'),
      tailleEvts: sp.getAll('taille_evenements[]'),
    });
    return NextResponse.json({ data: payload });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur inconnue';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
