import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, type AnyUserAuthContext } from '@/lib/api-auth.js';
import { isRegistreRole } from './registre.js';

// Authentifie un utilisateur autorisé au registre réglementaire : tous les rôles
// (staff + clients) SAUF l'agence (§09 F6). Le cloisonnement par organisation est
// porté par la vue/RLS ; cette garde n'ajoute que la matrice de capacité.
export async function requireRegistreUser(
  req: NextRequest,
): Promise<
  | { ctx: AnyUserAuthContext; error?: never }
  | { ctx?: never; error: NextResponse }
> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth;
  if (!isRegistreRole(auth.ctx.role)) {
    return {
      error: NextResponse.json(
        { error: 'Registre non accessible pour ce profil' },
        { status: 403 },
      ),
    };
  }
  return { ctx: auth.ctx };
}
