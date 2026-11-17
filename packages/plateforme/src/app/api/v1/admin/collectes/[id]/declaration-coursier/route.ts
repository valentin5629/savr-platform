// GET /api/v1/admin/collectes/[id]/declaration-coursier
//
// Ce que le coursier a déclaré à l'enlèvement (« Colis récupéré ») : poids pesé
// et champs de suppléments, relus chez le transporteur de la collecte (décision
// Val 2026-11-17). Lecture seule, rien n'est écrit.
// Accès : équipe Savr (requireStaff). Le transporteur n'est jamais nommé ici
// (garde-fou 3) : tout passe par @savr/adapters.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { lireDeclarationsCoursier } from '@savr/adapters/src/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Une relecture pour toutes les courses (30 s au plus).
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('collectes')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error, 'admin.collectes.declaration.collecte');
  if (!data) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  try {
    const lu = await lireDeclarationsCoursier(supabase, id, randomUUID());
    if (!lu.pris_en_charge) {
      return NextResponse.json(
        { error: 'Ce transporteur ne transmet pas de déclaration du coursier' },
        { status: 409 },
      );
    }
    return NextResponse.json({
      courses: lu.courses,
      courses_sans_declaration: lu.courses_sans_declaration,
    });
  } catch (e) {
    return serverError(e, 'admin.collectes.declaration.lecture');
  }
}
