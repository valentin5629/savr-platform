import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { writeError } from '@/lib/api-helpers.js';

// POST /api/me/demande-suppression
// RGPD Art.17 (§15 §3.3 l.101) — l'utilisateur authentifié (tout rôle) soumet une
// demande de suppression de son compte. Crée une ligne `demandes_suppression`
// `en_attente` (RLS self-insert). AUCUNE anonymisation immédiate : la validation
// Admin sous 48h ouvrées déclenchera `fn_anonymize_user` (anonymisation PII).
// Notification = file in-app admin (GET /api/v1/admin/demandes-suppression) ;
// pas d'email (le CDC §15 n'en mandate pas + catalogue gelé à 19 templates).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  // Justification optionnelle — un corps absent/vide est accepté (clic bouton).
  let justification: string | null = null;
  try {
    const body = (await req.json()) as { justification?: unknown };
    if (typeof body?.justification === 'string' && body.justification.trim()) {
      justification = body.justification.trim().slice(0, 2000);
    }
  } catch {
    // corps absent/non-JSON → justification null
  }

  const supabase = createSupabaseServerClient();

  // Idempotence douce : pas de doublon de demande en_attente pour le même user.
  const { data: existante } = await supabase
    .from('demandes_suppression')
    .select('id')
    .eq('user_id', auth.ctx.userId)
    .eq('statut', 'en_attente')
    .maybeSingle();

  if (existante) {
    return NextResponse.json(
      {
        data: { id: existante.id, statut: 'en_attente', deja_en_attente: true },
      },
      { status: 200 },
    );
  }

  const { data, error } = await supabase
    .from('demandes_suppression')
    .insert({ user_id: auth.ctx.userId, justification })
    .select('id, statut, demande_le')
    .single();

  if (error) return writeError(error, 'me.demande_suppression.create');

  return NextResponse.json({ data }, { status: 201 });
}
