import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireProgrammateurOuAdmin } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

// Référentiel global (aucun scoping org) → ouvert aussi à l'admin en
// programmation de support (§06.01 l.15).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('types_evenements')
    .select('id, code, libelle, ordre_affichage')
    .eq('actif', true)
    .order('ordre_affichage');

  if (error) return serverError(error, 'programmation.types_evenements.list');

  return NextResponse.json(data ?? []);
}
