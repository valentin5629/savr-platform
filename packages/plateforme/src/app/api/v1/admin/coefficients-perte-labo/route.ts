import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');

  let query = supabase
    .from('coefficients_perte_labo')
    .select(
      'id, organisation_id, organisations(raison_sociale), annee_reference, coefficient_kg_couvert, source_commentaire, cree_par_user_id, created_at',
    )
    .order('annee_reference', { ascending: false });

  if (organisation_id) query = query.eq('organisation_id', organisation_id);

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Écriture admin-only
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    organisation_id,
    annee_reference,
    coefficient_kg_couvert,
    source_commentaire,
  } = body as {
    organisation_id?: string;
    annee_reference?: number;
    coefficient_kg_couvert?: number;
    source_commentaire?: string;
  };

  if (
    !organisation_id ||
    annee_reference === undefined ||
    coefficient_kg_couvert === undefined
  ) {
    return NextResponse.json(
      {
        error:
          'organisation_id, annee_reference, coefficient_kg_couvert sont obligatoires',
      },
      { status: 422 },
    );
  }
  if (coefficient_kg_couvert < 0) {
    return NextResponse.json(
      { error: 'coefficient_kg_couvert doit être >= 0' },
      { status: 422 },
    );
  }
  if (
    !Number.isInteger(annee_reference) ||
    annee_reference < 2020 ||
    annee_reference > 2100
  ) {
    return NextResponse.json(
      { error: 'annee_reference invalide (2020-2100)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('coefficients_perte_labo')
    .insert({
      organisation_id,
      annee_reference,
      coefficient_kg_couvert,
      source_commentaire,
      cree_par_user_id: auth.ctx.userId,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        {
          error:
            'Un coefficient existe déjà pour cette organisation et cette année',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  try {
    await supabase.from('audit_log').insert({
      table_name: 'coefficients_perte_labo',
      record_id: data.id,
      action: 'creation_coefficient',
      user_id: auth.ctx.userId,
      new_values: { organisation_id, annee_reference, coefficient_kg_couvert },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json(data, { status: 201 });
}
