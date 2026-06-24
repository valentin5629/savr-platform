import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ filiere_id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { filiere_id } = await params;
  const idempotencyKey = req.headers.get('idempotency-key');

  const body = (await req.json()) as Record<string, unknown>;
  const { taux_captation, commentaire_modif } = body;

  if (taux_captation === undefined || taux_captation === null) {
    return NextResponse.json(
      { error: 'taux_captation est obligatoire' },
      { status: 422 },
    );
  }
  const taux = Number(taux_captation);
  if (isNaN(taux) || taux < 0 || taux > 1) {
    return NextResponse.json(
      { error: 'taux_captation doit être compris entre 0 et 1' },
      { status: 422 },
    );
  }
  if (!commentaire_modif || String(commentaire_modif).length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }

  // R3 / divergence M2.4 : passe par la RPC SECURITY DEFINER (auteur + motif en
  // contexte d'audit). La table principale n'a PAS de colonnes modifie_par/
  // modifie_le/commentaire_modif — l'historique va dans parametres_taux_recyclage_history
  // via le trigger fn_audit_taux_recyclage.
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_maj_taux_recyclage', {
    p_auteur: auth.ctx.userId,
    p_commentaire: String(commentaire_modif),
    p_id: filiere_id,
    p_taux: taux,
  });

  if (error) {
    if ((error.message ?? '').includes('introuvable')) {
      return NextResponse.json(
        { error: 'Filière introuvable' },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  void idempotencyKey; // utilisé pour dédup côté client si besoin
  return NextResponse.json(data);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filiere_id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { filiere_id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('parametres_taux_recyclage_history')
    .select('*')
    .eq('parametre_id', filiere_id)
    .order('created_at', { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
