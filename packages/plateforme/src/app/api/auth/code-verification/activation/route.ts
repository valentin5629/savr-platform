// POST /api/auth/code-verification/activation — prépare l'activation du code de
// vérification (TOTP) d'un compte de l'équipe Savr : QR code + clé à saisir dans
// l'application d'authentification. Le code n'est actif qu'après la première
// saisie réussie (`/verification`). Règle : lib/code-verification.ts.
//
// Refusée si un code est déjà actif : changer de téléphone passe par la
// réinitialisation par un autre administrateur (Supabase Auth exige de son côté
// une session `aal2` pour ajouter un facteur à un compte qui en a déjà un).

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { withApiTrace } from '@/lib/api-helpers.js';
import { lireSessionCodeVerification } from '@/lib/auth/session-code-verification';
import { exigeCodeVerification, facteursTotp } from '@/lib/code-verification';

export const runtime = 'nodejs';

const PAS_DE_CACHE = { 'Cache-Control': 'no-store' };

// Supabase rend le QR code en SVG brut derrière un préfixe `data:` non encodé :
// un `#` du SVG y couperait l'image. On le réencode.
function qrCodeImage(qrCode: string): string {
  const svg = qrCode.replace(/^data:image\/svg\+xml;[^,]*,/, '');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const POST = withApiTrace(
  async (_req: NextRequest): Promise<NextResponse> => {
    const supabase = createSupabaseServerClient();
    const session = await lireSessionCodeVerification(supabase);
    if (!session) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }
    if (!exigeCodeVerification(session.role)) {
      return NextResponse.json(
        { error: 'Réservé à l’équipe Savr' },
        { status: 403 },
      );
    }

    const { verifies, enAttente } = facteursTotp(session.user.factors);
    if (verifies.length > 0) {
      return NextResponse.json(
        { error: 'Le code de vérification est déjà activé sur ce compte.' },
        { status: 409 },
      );
    }

    // Activations commencées puis abandonnées (page rechargée) : retirées pour
    // ne pas atteindre le plafond de facteurs de Supabase. Sans effet sur un
    // code actif (il n'y en a pas, cf. ci-dessus).
    for (const facteur of enAttente) {
      await supabase.auth.mfa.unenroll({ factorId: facteur.id });
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      // Nom affiché par l'application d'authentification (avec l'email).
      issuer: 'Savr',
      // Nom interne, unique par compte (exigé par Supabase).
      friendlyName: `Savr ${new Date().toISOString()}`,
    });
    if (error || !data || data.type !== 'totp') {
      logger.error('auth.code_verification_activation_echec', {
        user_id: session.user.id,
        code: error?.code ?? null,
      });
      return NextResponse.json(
        {
          error:
            'Activation impossible pour le moment. Réessayez dans un instant.',
        },
        { status: 502, headers: PAS_DE_CACHE },
      );
    }

    logger.info('auth.code_verification_activation_demandee', {
      user_id: session.user.id,
    });

    return NextResponse.json(
      {
        factor_id: data.id,
        qr_code: qrCodeImage(data.totp.qr_code),
        secret: data.totp.secret,
      },
      { status: 200, headers: PAS_DE_CACHE },
    );
  },
);
