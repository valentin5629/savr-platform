// POST /api/v1/admin/factures/:id/lignes
// Bloc 3 de l'écran d'édition — ajoute une ligne (collecte existante OU ligne
// libre) à une facture brouillon, puis recalcule les totaux.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';
import {
  ajouterLigne,
  type NouvelleLigne,
} from '@/lib/facturation/edition-facture.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  let body: NouvelleLigne;
  try {
    body = (await req.json()) as NouvelleLigne;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  const result = await ajouterLigne(supabase, id, body);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.erreur },
      { status: result.statut ?? 422 },
    );
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
