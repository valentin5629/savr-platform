// POST /api/v1/admin/factures/:id/avoir
// Création d'un avoir intégral sur une facture emise ou payee.
// Body JSON : { motif: string }

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { creerAvoir } from '@/lib/facturation/avoirs.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;

  let body: { motif?: string } = {};
  try {
    body = (await req.json()) as { motif?: string };
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const motif = body.motif?.trim();
  if (!motif) {
    return NextResponse.json(
      { error: 'Le champ motif est requis' },
      { status: 400 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const result = await creerAvoir(supabase, id, motif);

  const status = result.ok ? 201 : 422;
  return NextResponse.json(result, { status });
}
