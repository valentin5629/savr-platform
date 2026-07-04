import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

/**
 * Catalogue LECTURE SEULE des templates emails actifs V1 (CDC §9 l.820-823).
 * L'édition du corps + variables + preview-avec-variables est reportée V1.1
 * (§06.02 « fait foi ») → cette route n'expose qu'un GET (aucune écriture).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('email_templates')
    .select('id, code, sujet, description, variables, corps_html, actif')
    .eq('actif', true)
    .order('code');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}
