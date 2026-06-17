import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const AGENCE_ROLES: ClientRole[] = ['agence'];

// PATCH /api/v1/agence/shadow/:id/siret — complétion SIRET d'une fiche traiteur
// shadow (§06.11 F2, modal fiche collecte « Hors référentiel »).
// On appelle la RPC SECURITY DEFINER f_completer_siret_shadow avec la session
// utilisateur (RLS client) : la RPC lit auth.jwt() (rôle agence + organisation)
// pour appliquer ses 5 gardes. Le trigger trg_cerfa_debloque_siret finalise
// ensuite les bordereaux Cerfa restés en brouillon (F4).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { siret?: string };
  const siret = (body.siret ?? '').trim();
  if (!/^[0-9]{14}$/.test(siret)) {
    return NextResponse.json(
      { error: 'Format SIRET invalide (14 chiffres requis)' },
      { status: 422 },
    );
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc('f_completer_siret_shadow', {
    p_org_id: id,
    p_siret: siret,
  });

  if (error) {
    // Les gardes RPC (rôle/créateur/non-shadow/écrasement) remontent en 422 métier
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json({ data: { id, siret } });
}
