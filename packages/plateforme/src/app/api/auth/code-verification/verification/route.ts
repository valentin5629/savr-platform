// POST /api/auth/code-verification/verification — vérifie le code à 6 chiffres
// d'un compte de l'équipe Savr. Réussi, la session passe au niveau `aal2`
// (nouveaux cookies posés sur cette réponse) jusqu'à sa fin : le code n'est plus
// redemandé avant la prochaine session. Règle : lib/code-verification.ts.
//
// Deux cas, choisis côté serveur d'après les facteurs du compte, jamais d'après
// le client :
//  • un code est déjà actif → c'est lui qui est vérifié (`factor_id` ignoré) ;
//  • activation en cours → `factor_id` doit désigner l'activation commencée par
//    `/activation` pour CE compte ; la première saisie réussie l'active.
//
// Défi et vérification partent du même appel : Supabase refuse une vérification
// venue d'une autre adresse IP que le défi (`mfa_ip_address_mismatch`), et deux
// appels serveur distincts pourraient sortir par deux adresses différentes.

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { readJsonBody, withApiTrace } from '@/lib/api-helpers.js';
import { lireSessionCodeVerification } from '@/lib/auth/session-code-verification';
import {
  exigeCodeVerification,
  facteursTotp,
  normaliserCode,
} from '@/lib/code-verification';
import { extractClientIp } from '@/lib/signup-rate-limit.js';

export const runtime = 'nodejs';

const PAS_DE_CACHE = { 'Cache-Control': 'no-store' };

function refus(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: PAS_DE_CACHE });
}

export const POST = withApiTrace(
  async (req: NextRequest): Promise<NextResponse> => {
    const parsed = await readJsonBody<{ code?: unknown; factor_id?: unknown }>(
      req,
    );
    if ('error' in parsed) return parsed.error;

    const code = normaliserCode(parsed.data.code);
    if (!code) return refus('Saisissez les 6 chiffres du code.', 422);

    const supabase = createSupabaseServerClient();
    const session = await lireSessionCodeVerification(supabase);
    if (!session) return refus('Non autorisé', 401);
    if (!exigeCodeVerification(session.claims)) {
      return refus(
        'Aucun code de vérification n’est demandé pour ce compte.',
        403,
      );
    }

    const { verifies, enAttente } = facteursTotp(session.user.factors);
    const activation = verifies.length === 0;
    const factorId = activation
      ? enAttente.find((f) => f.id === parsed.data.factor_id)?.id
      : verifies[0]!.id;
    if (!factorId) {
      return refus(
        'Cette activation n’est plus valable. Rechargez la page pour afficher un nouveau QR code.',
        409,
      );
    }

    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (error) {
      // §07/01 : alimente la surveillance des tentatives répétées, comme
      // `auth.login_failed`.
      logger.warn('auth.code_verification_echec', {
        user_id: session.user.id,
        ip: extractClientIp(req),
        activation,
        code: error.code ?? null,
      });
      if (error.status === 429 || error.code === 'over_request_rate_limit') {
        return refus(
          'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
          429,
        );
      }
      if (
        error.code === 'mfa_verification_failed' ||
        error.code === 'mfa_challenge_expired'
      ) {
        return refus(
          'Code incorrect. Saisissez le code affiché en ce moment par votre application (il change toutes les 30 secondes).',
          422,
        );
      }
      if (error.code === 'mfa_factor_not_found') {
        return refus(
          'Cette activation n’est plus valable. Rechargez la page pour afficher un nouveau QR code.',
          409,
        );
      }
      return refus(
        'Vérification impossible pour le moment. Réessayez dans un instant.',
        502,
      );
    }

    logger.info('auth.code_verification_ok', {
      user_id: session.user.id,
      activation,
    });
    return NextResponse.json({ ok: true }, { headers: PAS_DE_CACHE });
  },
);
