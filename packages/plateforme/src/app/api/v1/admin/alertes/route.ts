import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';

// GET /api/v1/admin/alertes?statut=ouverte
// File in-app des alertes Admin Savr (§07 Observabilité /03 §3 : le canal
// d'action des alertes FONCTIONNELLES est l'écran Admin, jamais Slack). La table
// plateforme.alertes_admin était peuplée par ~9 émetteurs (f_upsert_alerte_admin)
// sans aucun lecteur : cet endpoint est ce lecteur. Admin Savr uniquement
// (policy RLS aa_admin = admin_savr ; le gate requireAdmin la reflète).
const STATUTS = new Set(['ouverte', 'resolue', 'all']);

async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const statut = searchParams.get('statut') ?? 'ouverte';
  if (!STATUTS.has(statut)) {
    return NextResponse.json(
      { error: 'statut invalide (ouverte|resolue|all)' },
      { status: 400 },
    );
  }

  const supabase = createAdminSupabaseClient();
  let query = supabase
    .from('alertes_admin')
    .select(
      'id, code, titre, message, entity_type, entity_id, statut, created_at, resolue_at',
    )
    // Plus récentes d'abord : une nouvelle alerte critique remonte en tête.
    .order('created_at', { ascending: false });
  if (statut !== 'all') query = query.eq('statut', statut);

  const { data, error } = await query;
  if (error) return serverError(error, 'admin.alertes.list');
  return NextResponse.json({ data: data ?? [] });
}

export const GET = withApiTrace(getHandler);
