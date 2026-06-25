// PATCH / DELETE /api/v1/admin/factures/:id/lignes/:ligneId
// Bloc 2 de l'écran d'édition — modifie (désignation, quantité, TVA, override PU)
// ou supprime une ligne d'une facture brouillon, puis recalcule les totaux.
// L'override manuel du PU est tracé dans audit_log (FACT-05).

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';
import {
  modifierLigne,
  supprimerLigne,
  type LignePatch,
} from '@/lib/facturation/edition-facture.js';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ligneId: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id, ligneId } = await params;
  let body: LignePatch;
  try {
    body = (await req.json()) as LignePatch;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  const result = await modifierLigne(
    supabase,
    id,
    ligneId,
    body,
    auth.ctx.userId,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.erreur },
      { status: result.statut ?? 422 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ligneId: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id, ligneId } = await params;
  const supabase = createAdminSupabaseClient();
  const result = await supprimerLigne(supabase, id, ligneId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.erreur },
      { status: result.statut ?? 422 },
    );
  }
  return NextResponse.json({ ok: true });
}
