import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

// GET /api/me/export-rgpd
// RGPD Art.15 (accès) / Art.20 (portabilité) — §15 §3.3 l.105/109. Export JSON des
// données personnelles de l'utilisateur authentifié (self, RLS) : enregistrement
// d'identité + historique de ses demandes de suppression. Téléchargement direct.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();

  const { data: profil, error } = await supabase
    .from('users')
    .select(
      'id, email, prenom, nom, role, organisation_id, derniere_connexion, ' +
        'created_at, cgu_accepte_le, cgu_version',
    )
    .eq('id', auth.ctx.userId)
    .maybeSingle();

  if (error) return serverError(error, 'me.export_rgpd');
  if (!profil) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const { data: demandes } = await supabase
    .from('demandes_suppression')
    .select('id, statut, justification, demande_le, traitee_le')
    .eq('user_id', auth.ctx.userId)
    .order('demande_le', { ascending: false });

  const payload = {
    _meta: {
      genere_le: new Date().toISOString(),
      droit: 'RGPD Art.15 (accès) / Art.20 (portabilité)',
    },
    profil,
    demandes_suppression: demandes ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="mes-donnees-savr.json"',
    },
  });
}
