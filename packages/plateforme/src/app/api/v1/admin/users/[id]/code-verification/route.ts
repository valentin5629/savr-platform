// DELETE /api/v1/admin/users/[id]/code-verification — réinitialise le code de
// vérification d'un membre de l'équipe Savr (téléphone perdu ou changé) : retire
// ses facteurs TOTP. À sa prochaine connexion, il active un nouveau code (QR
// code). Ses sessions déjà ouvertes ne sont pas fermées.
//
// Réservé à `admin_savr` (session avec code, cf. getVerifiedClaims), jamais sur
// son propre compte : la procédure suppose un autre administrateur. Tracé dans
// `audit_log`. Procédure complète, y compris sans autre administrateur :
// docs/claude/code-verification.md.

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';

import { requireAdmin } from '@/lib/api-auth.js';
import { withApiTrace } from '@/lib/api-helpers.js';
import { exigeCodeVerification } from '@/lib/code-verification';

export const DELETE = withApiTrace(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    if (id === auth.ctx.userId) {
      return NextResponse.json(
        {
          error:
            'Vous ne pouvez pas réinitialiser votre propre code : demandez-le à un autre administrateur.',
        },
        { status: 422 },
      );
    }

    const supabase = createAdminSupabaseClient();
    const { data: cible, error } = await supabase
      .from('users')
      .select('id, email, role')
      .eq('id', id)
      .single();
    if (error || !cible) {
      return NextResponse.json(
        { error: 'Utilisateur non trouvé' },
        { status: 404 },
      );
    }
    if (!exigeCodeVerification(cible.role)) {
      return NextResponse.json(
        { error: 'Ce compte n’utilise pas de code de vérification.' },
        { status: 422 },
      );
    }

    const { data: liste, error: listeError } =
      await supabase.auth.admin.mfa.listFactors({ userId: id });
    if (listeError || !liste) {
      logger.error('auth.code_verification_reinitialisation_echec', {
        target_user: id,
        code: listeError?.code ?? null,
      });
      return NextResponse.json(
        { error: 'Réinitialisation impossible pour le moment.' },
        { status: 502 },
      );
    }

    let retires = 0;
    for (const facteur of liste.factors) {
      if (facteur.factor_type !== 'totp') continue;
      const { error: suppressionError } =
        await supabase.auth.admin.mfa.deleteFactor({
          id: facteur.id,
          userId: id,
        });
      if (suppressionError) {
        logger.error('auth.code_verification_reinitialisation_echec', {
          target_user: id,
          code: suppressionError.code ?? null,
        });
        return NextResponse.json(
          { error: 'Réinitialisation impossible pour le moment.' },
          { status: 502 },
        );
      }
      retires += 1;
    }

    // §07/01 event business + §07/06 écriture sensible (audit_log, auteur =
    // l'administrateur, ligne = le compte réinitialisé).
    logger.warn('auth.code_verification_reinitialise', {
      by_user: auth.ctx.userId,
      target_user: id,
      facteurs_retires: retires,
    });
    const { error: auditError } = await supabase.from('audit_log').insert({
      table_name: 'users',
      record_id: id,
      action: 'code_verification_reinitialise',
      user_id: auth.ctx.userId,
      role: auth.ctx.role,
      new_values: { email: cible.email, facteurs_retires: retires },
    });
    if (auditError) {
      logger.error('auth.code_verification_reinitialise.audit_echec', {
        target_user: id,
        code: auditError.code ?? null,
      });
    }

    return NextResponse.json({ facteurs_retires: retires });
  },
);
