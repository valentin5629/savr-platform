import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';

// GET /api/me/acces — BL-P3-13 « Sécurité du compte » (CDC §15 §2.3).
// Historique SELF des accès admin (impersonation) au compte de l'utilisateur
// authentifié. Passe par la RPC SECURITY DEFINER f_mes_acces_compte(), scopée
// auth.uid() : audit_log est staff-only, on n'expose QUE ses propres accès et
// JAMAIS l'identité de l'admin (date + libellé générique).
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc('f_mes_acces_compte');

  if (error) return serverError(error, 'me.acces.get');
  return NextResponse.json({ data: data ?? [] });
}

export const GET = withApiTrace(getHandler);
