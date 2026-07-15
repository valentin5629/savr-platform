import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
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
    .from('associations')
    .select('*')
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Association introuvable' },
      { status: 404 },
    );
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // KPI fiche — collectes AG réalisées rattachées à cette association sur les
  // 30 derniers jours. Rattachement via attributions_antgaspi.association_id
  // (1 attribution par collecte AG, collecte_id UNIQUE). « Réalisées » = statuts
  // terminaux avec collecte effective (realisee + cloturee) ; realisee_sans_collecte
  // est exclu (aucun don parvenu à l'association). Décision Val — revue E2E 2026-07-15.
  const cutoff30j = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { count: collectesRealisees30j, error: kpiError } = await supabase
    .from('attributions_antgaspi')
    .select('collecte_id, collectes!inner(statut,date_collecte,type)', {
      count: 'exact',
      head: true,
    })
    .eq('association_id', id)
    .eq('collectes.type', 'anti_gaspi')
    .in('collectes.statut', ['realisee', 'cloturee'])
    .gte('collectes.date_collecte', cutoff30j);

  // Dégradation gracieuse : un KPI en échec ne doit pas casser la fiche
  // (retombe à 0), mais l'échec est tracé pour ne pas rester silencieux.
  if (kpiError) {
    logger.warn('associations.kpi_collectes_30j_failed', {
      association_id: id,
      error: kpiError.message,
    });
  }

  return NextResponse.json({
    ...data,
    collectes_realisees_30j: collectesRealisees30j ?? 0,
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

  // Champs editables par ops_savr (§5 associations : contacts, horaires,
  // instructions, capacité, description). logo/instructions_acces = ops OK.
  const OPS_FIELDS = [
    'contact_nom',
    'contact_email',
    'contact_telephone',
    'horaires_ouverture',
    'description_rapport_impact',
    'capacite_max_beneficiaires',
    'types_aliments_acceptes',
    'commentaires_internes',
    'instructions_acces',
    'logo_url',
    'nom',
    'adresse',
    'ville',
    'region',
  ];
  // Champs admin-only (§5 associations l.425-426 : SIREN + habilitation 2041-GE
  // (booléen + date d'expiration) + désactivation `actif`). Ajout Val 2026-07-02 :
  // siren (col. créée) + date_expiration_habilitation.
  const ADMIN_FIELDS = [
    'habilitee_attestation_fiscale',
    'date_expiration_habilitation',
    'siren',
    'id_point_collecte_mts1',
    'actif',
  ];

  const allowedFields =
    auth.ctx.role === 'admin_savr'
      ? [...OPS_FIELDS, ...ADMIN_FIELDS]
      : OPS_FIELDS;

  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowedFields.includes(k)),
  );

  // Ops ne peut pas modifier champs admin-only
  if (auth.ctx.role === 'ops_savr') {
    const blockedKeys = Object.keys(body).filter((k) =>
      ADMIN_FIELDS.includes(k),
    );
    if (blockedKeys.length > 0) {
      return NextResponse.json(
        { error: 'Champs réservés admin : ' + blockedKeys.join(', ') },
        { status: 403 },
      );
    }
  }

  if (
    updates.description_rapport_impact !== undefined &&
    typeof updates.description_rapport_impact === 'string' &&
    updates.description_rapport_impact.length < 30
  ) {
    return NextResponse.json(
      {
        error:
          'description_rapport_impact doit contenir au moins 30 caractères',
      },
      { status: 422 },
    );
  }

  // SIREN non obligatoire mais 9 chiffres si fourni (vide = effacement autorisé).
  if (
    typeof updates.siren === 'string' &&
    updates.siren !== '' &&
    !/^\d{9}$/.test(updates.siren)
  ) {
    return NextResponse.json(
      { error: 'siren doit contenir 9 chiffres' },
      { status: 422 },
    );
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data: before, error: fetchErr } = await supabase
    .from('associations')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !before) {
    return NextResponse.json(
      { error: 'Association introuvable' },
      { status: 404 },
    );
  }

  // Géocodage en background au save (§5 Associations « Adresse + géocodage auto ») —
  // relancé uniquement si adresse/ville change, fail-open (pas de blocage si l'API
  // externe échoue, cf. packages/plateforme/src/lib/geocoding.ts).
  if (updates.adresse !== undefined || updates.ville !== undefined) {
    const beforeAsso = before as { adresse: string; ville: string };
    const coords = await geocodeAdresse(
      (updates.adresse as string | undefined) ?? beforeAsso.adresse,
      '',
      (updates.ville as string | undefined) ?? beforeAsso.ville,
    );
    if (coords) {
      updates.latitude = coords.latitude;
      updates.longitude = coords.longitude;
    }
  }

  const { data, error } = await supabase
    .from('associations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'associations',
    record_id: id,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_values: before,
    new_values: data,
  });

  return NextResponse.json(data);
}
