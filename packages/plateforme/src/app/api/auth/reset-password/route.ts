// POST /api/auth/reset-password — demande « mot de passe oublié ».
//
// Depuis le 2026-11-06 (Val), l'email part par Resend, comme l'inscription et
// l'invitation : Supabase fabrique le lien (`auth.admin.generateLink`), la
// plateforme l'envoie avec le gabarit `reset_password`. Avant, Supabase Auth
// l'envoyait lui-même depuis son expéditeur par défaut, qui ne livre qu'aux
// membres de l'équipe du projet : un client ne l'aurait jamais reçu.
// L'envoi passe ainsi par la garde hors production (transport.ts) et laisse une
// ligne dans `emails_envoyes`.
//
// La réponse est toujours 200, que l'adresse existe ou non, et l'envoi se fait
// après la réponse : ni le code ni le temps de réponse ne révèlent un compte.
import { after, NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { urlCanonique } from '@/lib/url-application.js';
import { demandeReinitialisationLimitee } from '@/lib/reset-password-rate-limit.js';
import { extractClientIp } from '@/lib/signup-rate-limit.js';

const ROUTE_CONFIRMATION = '/api/auth/reset-password/confirm';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const email =
    typeof body['email'] === 'string' ? body['email'].trim() : undefined;
  if (!email) {
    return NextResponse.json({ error: 'Email requis' }, { status: 422 });
  }

  // Le domaine du lien vient de la seule configuration (`NEXT_PUBLIC_APP_URL`),
  // jamais de la requête : ce lien ouvre une session sur le compte, il ne doit
  // pas pouvoir viser un domaine tiers par un en-tête `Host` forgé. Sans
  // variable, rien n'est envoyé (l'erreur est tracée par `urlCanonique`).
  const lienConfirmation = urlCanonique(ROUTE_CONFIRMATION);
  const lienAbsolu = /^https?:\/\//.test(lienConfirmation);

  // Plafond dépassé : même réponse, rien n'est envoyé.
  if (
    lienAbsolu &&
    !demandeReinitialisationLimitee(email, extractClientIp(req))
  ) {
    after(() => envoyerLienReinitialisation(email, lienConfirmation));
  }

  return NextResponse.json({ success: true }, { status: 200 });
}

async function envoyerLienReinitialisation(
  email: string,
  lienConfirmation: string,
): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    // Adresse inconnue : Supabase répond une erreur, rien n'est envoyé.
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    const tokenHash = data?.properties?.hashed_token;
    const userId = data?.user?.id;
    if (error || !tokenHash || !userId) return;

    const { data: profil } = await admin
      .from('users')
      .select('prenom')
      .eq('id', userId)
      .maybeSingle();

    // Le lien vise la route qui échange le jeton contre une session
    // (`confirm/route.ts`), jamais la page du formulaire directement.
    const lien = new URL(lienConfirmation);
    lien.searchParams.set('token_hash', tokenHash);
    lien.searchParams.set('type', 'recovery');

    await sendEmail('reset_password', data.user.email ?? email, {
      // Le corps est du HTML interpolé tel quel : le texte saisi est échappé.
      prenom: escapeHtml((profil?.prenom as string | null) ?? ''),
      lien_reset: lien.toString(),
    });
  } catch (err) {
    // Ni l'adresse ni le lien : le nom de l'erreur suffit.
    logger.error('auth.reset_password.envoi_echoue', {
      erreur: err instanceof Error ? err.name : 'inconnue',
    });
  }
}
