// DELETE /api/v1/admin/users/[id]/code-verification — réinitialise le code de
// vérification d'un membre de l'équipe Savr (téléphone perdu ou changé) : retire
// ses facteurs TOTP. À sa prochaine connexion, il active un nouveau code (QR
// code). Ses sessions déjà ouvertes ne sont pas fermées.
//
// Réservé à `admin_savr` (avec code en production, cf. getVerifiedClaims), jamais sur
// son propre compte : la procédure suppose un autre administrateur. Tracé dans
// `audit_log`. Procédure complète, y compris sans autre administrateur :
// docs/claude/code-verification.md.

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';

import { requireAdmin } from '@/lib/api-auth.js';
import { withApiTrace } from '@/lib/api-helpers.js';
import { isStaff } from '@/lib/roles';

export const DELETE = withApiTrace(
  async (
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<NextResponse> => {
    const auth = await requireAdmin(req);
    if (auth.error) return auth.error;

    const { id } = await params;
    const supabase = createAdminSupabaseClient();
    const { data: cible, error } = await supabase
      .from('users')
      .select('id, role')
      .eq('id', id)
      .single();
    if (error || !cible) {
      return NextResponse.json(
        { error: 'Utilisateur non trouvé' },
        { status: 404 },
      );
    }
    // Comparaison sur l'identifiant RELU en base, jamais sur le paramètre d'URL :
    // Postgres lit un uuid sans tenir compte de la casse ni des accolades
    // (« A0EE… » ou « {a0ee…} » désignent le même compte que « a0ee… »).
    const cibleId = cible.id;
    if (cibleId === auth.ctx.userId) {
      return NextResponse.json(
        {
          error:
            'Vous ne pouvez pas réinitialiser votre propre code : demandez-le à un autre administrateur.',
        },
        { status: 422 },
      );
    }
    // Compte de l'équipe Savr, en production comme ailleurs : hors production
    // le code n'est pas demandé, mais un facteur activé lors d'un essai doit
    // pouvoir être retiré.
    if (!isStaff(cible.role)) {
      return NextResponse.json(
        { error: 'Ce compte n’utilise pas de code de vérification.' },
        { status: 422 },
      );
    }

    // §07/01 event business + §07/06 écriture sensible (audit_log, auteur =
    // l'administrateur, ligne = le compte réinitialisé, aucune donnée
    // personnelle). Aussi appelée après un échec partiel : ce qui a été retiré
    // est tracé.
    const tracer = async (retires: number): Promise<void> => {
      logger.warn('auth.code_verification_reinitialise', {
        by_user: auth.ctx.userId,
        target_user: cibleId,
        facteurs_retires: retires,
      });
      const { error: auditError } = await supabase.from('audit_log').insert({
        table_name: 'users',
        record_id: cibleId,
        action: 'code_verification_reinitialise',
        user_id: auth.ctx.userId,
        role: auth.ctx.role,
        new_values: { facteurs_retires: retires },
      });
      if (auditError) {
        logger.error('auth.code_verification_reinitialise.audit_echec', {
          by_user: auth.ctx.userId,
          target_user: cibleId,
          code: auditError.code ?? null,
        });
      }
    };
    const echec = (code: string | undefined, retires: number) => {
      logger.error('auth.code_verification_reinitialisation_echec', {
        by_user: auth.ctx.userId,
        target_user: cibleId,
        facteurs_retires: retires,
        code: code ?? null,
      });
      return NextResponse.json(
        { error: 'Réinitialisation impossible pour le moment.' },
        { status: 502 },
      );
    };

    const { data: liste, error: listeError } =
      await supabase.auth.admin.mfa.listFactors({ userId: cibleId });
    if (listeError || !liste) return echec(listeError?.code, 0);

    let retires = 0;
    for (const facteur of liste.factors) {
      if (facteur.factor_type !== 'totp') continue;
      const { error: suppressionError } =
        await supabase.auth.admin.mfa.deleteFactor({
          id: facteur.id,
          userId: cibleId,
        });
      if (suppressionError) {
        if (retires > 0) await tracer(retires);
        return echec(suppressionError.code, retires);
      }
      retires += 1;
    }

    // Aucun code actif ni activation en cours : rien n'a changé, rien à tracer.
    if (retires === 0) return NextResponse.json({ facteurs_retires: 0 });

    await tracer(retires);
    return NextResponse.json({ facteurs_retires: retires });
  },
);
