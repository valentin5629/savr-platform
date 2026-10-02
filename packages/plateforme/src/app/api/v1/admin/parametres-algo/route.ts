import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin, requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { valeurConformeAuType } from '@/lib/parametres-algo/validation.js';

// GET /api/v1/admin/parametres-algo — lecture (ops + admin)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_algo')
    .select('cle, valeur, type_valeur, description, updated_at')
    .order('cle');

  if (error) return serverError(error, 'admin.parametres_algo.list');
  return NextResponse.json({ data: data ?? [] });
}

// PATCH /api/v1/admin/parametres-algo — écriture admin uniquement
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: { cle: string; valeur: unknown };
  try {
    body = (await req.json()) as { cle: string; valeur: unknown };
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  if (!body.cle || body.valeur === undefined) {
    return NextResponse.json(
      { error: 'cle et valeur obligatoires' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Le type attendu est celui de la ligne, pas celui que le client déclare.
  const { data: ligne, error: erreurLecture } = await supabase
    .from('parametres_algo')
    .select('type_valeur')
    .eq('cle', body.cle)
    .maybeSingle();
  if (erreurLecture)
    return serverError(erreurLecture, 'admin.parametres_algo.update');
  if (!ligne)
    return NextResponse.json(
      { error: `Paramètre inconnu: ${body.cle}` },
      { status: 404 },
    );
  const conformite = valeurConformeAuType(ligne.type_valeur, body.valeur);
  if (!conformite.ok)
    return NextResponse.json(
      {
        error: `Valeur invalide pour « ${body.cle} » : ${conformite.attendu} attendu(e)`,
      },
      { status: 422 },
    );

  const { data, error } = await supabase
    .from('parametres_algo')
    .update({ valeur: body.valeur, updated_at: new Date().toISOString() })
    .eq('cle', body.cle)
    .select('cle, valeur, type_valeur, updated_at')
    .single();

  if (error) {
    if (error.code === 'PGRST116')
      return NextResponse.json(
        { error: `Paramètre inconnu: ${body.cle}` },
        { status: 404 },
      );
    return serverError(error, 'admin.parametres_algo.update');
  }

  return NextResponse.json({ data });
}
