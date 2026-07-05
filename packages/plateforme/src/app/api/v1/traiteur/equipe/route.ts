import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

// CDC §06.04 §6 « Équipe » (l.665-671) — liste des utilisateurs rattachés :
// nom, email, rôle, dernière connexion. Section MANAGER only (l.653 « Équipe
// masquée » pour le commercial). RLS usr_manager_select (own-org).

const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, prenom, nom, email, role, actif, derniere_connexion, created_at',
    )
    .order('nom');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
