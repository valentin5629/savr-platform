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
    .from('lieux')
    .select('*')
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'Lieu introuvable' }, { status: 404 });
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Gestionnaire rattaché (organisations_lieux) — exposé pour pré-remplir la fiche
  // (id) + affichage lecture (nom via jointure organisations).
  const { data: lien } = await supabase
    .from('organisations_lieux')
    .select('organisation_id, organisations(nom, raison_sociale)')
    .eq('lieu_id', id)
    .limit(1)
    .maybeSingle();

  const org = (
    lien as {
      organisations?: { nom?: string; raison_sociale?: string } | null;
    } | null
  )?.organisations;

  return NextResponse.json({
    ...(data as Record<string, unknown>),
    gestionnaire_organisation_id:
      (lien as { organisation_id?: string } | null)?.organisation_id ?? null,
    gestionnaire_nom: org?.raison_sociale ?? org?.nom ?? null,
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
    'nom_alternatif',
    'adresse_acces',
    'code_postal',
    'ville',
    'region',
    'latitude',
    'longitude',
    'acces_details',
    'acces_office',
    'stationnement',
    'type_vehicule_max',
    'contraintes_horaires',
    'flux_autorises',
    'volume_max_bacs',
    'capacite_maximum',
    'controle_acces_requis_default',
    'photos_urls',
    'commentaires_internes',
    'commentaire_lieu',
    'siren',
    'email_gestionnaire',
    'reference_citeo',
    'actif',
  ];
  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_FIELDS.includes(k)),
  );

  // Le rattachement gestionnaire (organisations_lieux) est un champ hors-colonne
  // lieux : compte comme une modification valide même si aucune colonne lieu ne change.
  const gestionnaireProvided = 'gestionnaire_organisation_id' in body;

  if (Object.keys(updates).length === 0 && !gestionnaireProvided) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data: before, error: fetchErr } = await supabase
    .from('lieux')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !before) {
    return NextResponse.json({ error: 'Lieu introuvable' }, { status: 404 });
  }

  // Géocodage en background au save, relancé si adresse/code_postal/ville change
  // — fail-open, cf. lib/geocoding.ts.
  if (
    updates.adresse_acces !== undefined ||
    updates.code_postal !== undefined ||
    updates.ville !== undefined
  ) {
    const beforeLieu = before as {
      adresse_acces: string;
      code_postal: string;
      ville: string;
    };
    const coords = await geocodeAdresse(
      (updates.adresse_acces as string | undefined) ?? beforeLieu.adresse_acces,
      (updates.code_postal as string | undefined) ?? beforeLieu.code_postal,
      (updates.ville as string | undefined) ?? beforeLieu.ville,
    );
    if (coords) {
      updates.latitude = coords.latitude;
      updates.longitude = coords.longitude;
    }
  }

  const { data, error } = await supabase
    .from('lieux')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Rattachement gestionnaire (organisations_lieux) — remplacement single :
  // on retire le lien existant du lieu puis on pose le nouveau (si fourni).
  // Décision Val 2026-07-02 : 1 gestionnaire par lieu, non obligatoire.
  if (gestionnaireProvided) {
    const gestionnaireId =
      typeof body.gestionnaire_organisation_id === 'string' &&
      body.gestionnaire_organisation_id !== ''
        ? body.gestionnaire_organisation_id
        : null;
    await supabase.from('organisations_lieux').delete().eq('lieu_id', id);
    if (gestionnaireId) {
      await supabase.from('organisations_lieux').insert({
        organisation_id: gestionnaireId,
        lieu_id: id,
        created_by: auth.ctx.userId,
      });
    }
  }

  await supabase.from('audit_log').insert({
    table_name: 'lieux',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_values: before,
    new_values: data,
  });

  return NextResponse.json(data);
}
