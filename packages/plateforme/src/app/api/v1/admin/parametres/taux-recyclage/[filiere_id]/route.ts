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

  // CDC §9 l.783 : le front génère + envoie un Idempotency-Key (UUID v4). La
  // spec n'exige PAS de dédup serveur en V1 (aucun store de dédup requis) — on
  // accepte l'en-tête sans le rejeter. Une garde serveur relèverait de V1.1.
  void idempotencyKey;
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

  // Historique antéchronologique (CDC §9 l.796-800). Colonnes taux/prestataire/
  // source avant-après + commentaire + auteur, alimentées par le trigger
  // fn_audit_taux_recyclage.
  const { data, error } = await supabase
    .from('parametres_taux_recyclage_history')
    .select('*')
    .eq('parametre_id', filiere_id)
    .order('modifie_le', { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Résout « Modifié par » en nom lisible via une 2e requête (pas d'embed
  // PostgREST — évite les 400 de jointure ; volumétrie ≤ 10 modifs/an).
  const auteurIds = [...new Set(rows.map((r) => r.modifie_par))];
  const nameById = new Map<string, string>();
  if (auteurIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, prenom, nom')
      .in('id', auteurIds);
    for (const u of users ?? []) {
      nameById.set(u.id, `${u.prenom ?? ''} ${u.nom ?? ''}`.trim());
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    modifie_par_nom: nameById.get(r.modifie_par) || r.modifie_par,
  }));

  return NextResponse.json({ data: enriched });
}
