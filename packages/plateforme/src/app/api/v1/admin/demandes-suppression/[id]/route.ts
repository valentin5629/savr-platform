import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { readJsonBody, serverError, writeError } from '@/lib/api-helpers.js';

// PATCH /api/v1/admin/demandes-suppression/[id]
// Validation Admin sous 48h d'une demande RGPD (§15 §3.3 l.101) :
//   action=valider → fn_anonymize_user (anonymisation PII, pièces comptables
//                    préservées, ligne audit_log) + ban/anonymisation Auth best-effort ;
//   action=refuser → demande clôturée 'refusee'.
// Remplace le NÉANT existant : `auth.admin.deleteUser` (admin/users/route.ts) est un
// rollback de création, PAS un chemin RGPD — aucun hard-delete brut n'est utilisé ici.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const parsed = await readJsonBody<{
    action?: string;
    justification?: string;
  }>(req);
  if ('error' in parsed) return parsed.error;
  const action = parsed.data.action;
  if (action !== 'valider' && action !== 'refuser') {
    return NextResponse.json(
      { error: 'action invalide (valider|refuser)' },
      { status: 400 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data: demande, error: errLect } = await supabase
    .from('demandes_suppression')
    .select('id, user_id, statut')
    .eq('id', id)
    .maybeSingle();
  if (errLect) return serverError(errLect, 'admin.demande_suppression.read');
  if (!demande) {
    return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 });
  }
  if (demande.statut !== 'en_attente') {
    return NextResponse.json(
      { error: 'Demande déjà traitée' },
      { status: 409 },
    );
  }

  if (action === 'refuser') {
    const { error } = await supabase
      .from('demandes_suppression')
      .update({
        statut: 'refusee',
        traitee_le: new Date().toISOString(),
        traitee_par: auth.ctx.userId,
      })
      .eq('id', id);
    if (error) return writeError(error, 'admin.demande_suppression.refuser');
    return NextResponse.json({ data: { id, statut: 'refusee' } });
  }

  // valider → anonymisation PII atomique (UPDATE users + clôture demande + audit).
  const justification =
    typeof parsed.data.justification === 'string' && parsed.data.justification
      ? parsed.data.justification
      : 'Demande RGPD validée';
  const { error: errRpc } = await supabase.rpc('fn_anonymize_user', {
    p_user_id: demande.user_id,
    p_justification: justification,
    p_acteur: auth.ctx.userId,
    p_demande_id: id,
  });
  if (errRpc)
    return serverError(errRpc, 'admin.demande_suppression.anonymiser');

  // Best-effort : neutralise aussi l'identité Auth (login impossible + email PII).
  // Non bloquant : la conformité légale est déjà assurée par l'anonymisation DB.
  await supabase.auth.admin
    .updateUserById(demande.user_id, {
      email: `anonymise+${demande.user_id}@anonymise.invalid`,
      ban_duration: '876000h',
      user_metadata: { anonymise: true },
    })
    .catch(() => null);

  return NextResponse.json({
    data: { id, statut: 'validee', user_id: demande.user_id },
  });
}
