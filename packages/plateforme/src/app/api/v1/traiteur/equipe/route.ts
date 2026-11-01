import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

// CDC §06.04 §6 « Équipe » (l.665-671) — liste des utilisateurs rattachés :
// nom, email, rôle, dernière connexion. Manager et commercial (Val 2026-10-30 :
// le commercial voit l'équipe pour inviter et transférer ses collectes). RLS
// usr_manager_select / usr_commercial_select (own-org).

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, prenom, nom, email, poste, role, actif, derniere_connexion, created_at',
    )
    .order('nom');

  if (error) return serverError(error, 'traiteur.equipe.list');
  return NextResponse.json({ data: data ?? [] });
}
