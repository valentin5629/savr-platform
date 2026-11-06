// POST /api/auth/invitation — enregistre le mot de passe choisi depuis le lien de
// l'email d'invitation (lien Savr valable 7 jours, à usage unique ; cf.
// lib/auth/jeton-invitation.ts). Route publique : la personne n'a pas encore de
// mot de passe, le jeton signé tient lieu de preuve.
//
// Le mot de passe est posé par le client de service, puis le nonce du compte est
// effacé : le même lien ne peut plus servir. La personne se connecte ensuite
// normalement (page de connexion), qui l'oriente vers son espace.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { validatePasswordStrength } from '@/lib/password.js';
import { authAccountError } from '@/lib/api-helpers.js';
import { lireEtatInvitation } from '@/lib/auth/etat-invitation.js';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  const jeton = typeof body.jeton === 'string' ? body.jeton : '';
  const motDePasse =
    typeof body.mot_de_passe === 'string' ? body.mot_de_passe : '';

  const admin = createAdminSupabaseClient();
  const etat = await lireEtatInvitation(admin, jeton);
  if (!etat.ok) {
    return NextResponse.json(
      { error: 'Lien d’invitation inutilisable', motif: etat.motif },
      { status: etat.motif === 'invalide' ? 400 : 410 },
    );
  }

  // Même politique que l'inscription et la réinitialisation (§09 l.84-85).
  const force = validatePasswordStrength(motDePasse);
  if (!force.ok) {
    return NextResponse.json({ error: force.error }, { status: 422 });
  }

  const { error } = await admin.auth.admin.updateUserById(etat.userId, {
    password: motDePasse,
    app_metadata: { invitation_nonce: null },
  });
  if (error) {
    return authAccountError(
      error,
      'auth.invitation',
      'Enregistrement du mot de passe impossible. Réessayez dans un instant.',
    );
  }

  return NextResponse.json({ success: true });
}
