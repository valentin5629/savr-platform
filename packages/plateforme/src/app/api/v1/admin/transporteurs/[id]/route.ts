import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { geocodeAdresse } from '@/lib/geocoding.js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('transporteurs')
    .select('*')
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Transporteur introuvable' },
      { status: 404 },
    );
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Nom du prestataire logistique (pont V1 shared.prestataires) — exposé en
  // lecture pour la fiche (« toutes les informations », Val 2026-07-02).
  const prestaId = (data as { prestataire_logistique_id: string | null })
    .prestataire_logistique_id;
  let prestataire_logistique_nom: string | null = null;
  if (prestaId) {
    const { data: presta } = await supabase
      .schema('shared')
      .from('prestataires')
      .select('nom')
      .eq('id', prestaId)
      .maybeSingle();
    prestataire_logistique_nom =
      (presta as { nom?: string } | null)?.nom ?? null;
  }

  return NextResponse.json({
    ...(data as Record<string, unknown>),
    prestataire_logistique_nom,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  const ALLOWED_FIELDS = [
    'nom',
    'siren',
    'adresse',
    'code_postal',
    'ville',
    'latitude',
    'longitude',
    'types_vehicules',
    'types_collecte',
    'type_tms',
    'description_process_collecte',
    'code_transporteur_mts1',
    'contact_nom',
    'contact_email',
    'contact_telephone',
    'tarif_par_course',
    'actif',
    'commentaires_internes',
    'derniere_verification',
  ];
  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_FIELDS.includes(k)),
  );

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const finalTypeTms = updates.type_tms ?? undefined;
  if (finalTypeTms === 'mts1' && !updates.code_transporteur_mts1) {
    return NextResponse.json(
      { error: 'code_transporteur_mts1 requis pour type_tms=mts1' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data: before, error: fetchErr } = await supabase
    .from('transporteurs')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !before) {
    return NextResponse.json(
      { error: 'Transporteur introuvable' },
      { status: 404 },
    );
  }

  const effectiveTypeTms = (updates.type_tms ??
    (before as { type_tms: string }).type_tms) as string;
  const effectiveCode =
    updates.code_transporteur_mts1 ??
    (before as { code_transporteur_mts1: string | null })
      .code_transporteur_mts1;
  if (effectiveTypeTms === 'mts1' && !effectiveCode) {
    return NextResponse.json(
      { error: 'code_transporteur_mts1 requis pour type_tms=mts1' },
      { status: 422 },
    );
  }

  // Géocodage en background au save, relancé si adresse/code_postal/ville change
  // — fail-open, cf. packages/plateforme/src/lib/geocoding.ts.
  if (
    updates.adresse !== undefined ||
    updates.code_postal !== undefined ||
    updates.ville !== undefined
  ) {
    const beforeTransp = before as {
      adresse: string;
      code_postal: string;
      ville: string;
    };
    const coords = await geocodeAdresse(
      (updates.adresse as string | undefined) ?? beforeTransp.adresse,
      (updates.code_postal as string | undefined) ?? beforeTransp.code_postal,
      (updates.ville as string | undefined) ?? beforeTransp.ville,
    );
    if (coords) {
      updates.latitude = coords.latitude;
      updates.longitude = coords.longitude;
    }
  }

  const { data, error } = await supabase
    .from('transporteurs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'transporteurs',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_values: before,
    new_values: data,
  });

  return NextResponse.json(data);
}
