import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { requireStaff } from '@/lib/api-auth.js';
import { sanitizeOrTerm } from '@/lib/api-helpers.js';
import { geocodeAdresse } from '@/lib/geocoding.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const actif = searchParams.get('actif');
  const region = searchParams.get('region');
  const q = sanitizeOrTerm(searchParams.get('q') ?? ''); // C2 : neutralise l'injection .or
  // BL-P1-ALGO-03 — recherche libre association (CDC §06.09 §2 « Choisir une autre
  // association ») : filtres ville (q), capacité min, habilitation 2041-GE.
  const capaciteMinRaw = searchParams.get('capacite_min');
  const capaciteMin =
    capaciteMinRaw !== null && capaciteMinRaw !== ''
      ? parseInt(capaciteMinRaw, 10)
      : null;
  const habilitee = searchParams.get('habilitee'); // '2041-GE'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('associations')
    .select('*', { count: 'exact' })
    .order('nom')
    .range(offset, offset + limit - 1);

  if (actif !== null) query = query.eq('actif', actif === 'true');
  if (region) query = query.eq('region', region);
  if (q) query = query.or(`nom.ilike.%${q}%,ville.ilike.%${q}%`);
  if (capaciteMin !== null && Number.isFinite(capaciteMin))
    query = query.gte('capacite_max_beneficiaires', capaciteMin);
  if (habilitee === 'true' || habilitee === '2041-GE')
    query = query.eq('habilitee_attestation_fiscale', true);

  const { data, error, count } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // KPI par ligne — collectes AG réalisées (realisee + cloturee) rattachées via
  // attributions_antgaspi.association_id, sur les 30 derniers jours. Une seule
  // requête agrégée pour toute la page (≤ 50 assos, pas de N+1), comptée par asso.
  const rows = (data ?? []) as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const cutoff30j = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data: attrs, error: kpiError } = await supabase
      .from('attributions_antgaspi')
      .select('association_id, collectes!inner(statut,date_collecte,type)')
      .in('association_id', ids)
      .eq('collectes.type', 'anti_gaspi')
      .in('collectes.statut', ['realisee', 'cloturee'])
      .gte('collectes.date_collecte', cutoff30j);
    if (kpiError) {
      // Dégradation gracieuse : la liste ne casse pas, les compteurs restent à 0.
      logger.warn('associations.kpi_collectes_30j_list_failed', {
        error: kpiError.message,
      });
    } else {
      for (const a of (attrs ?? []) as Array<{ association_id: string }>) {
        counts.set(a.association_id, (counts.get(a.association_id) ?? 0) + 1);
      }
    }
  }
  const enriched = rows.map((r) => ({
    ...r,
    collectes_realisees_30j: counts.get(r.id) ?? 0,
  }));

  return NextResponse.json({ data: enriched, total: count ?? 0 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const {
    nom,
    adresse,
    region,
    ville,
    contact_email,
    description_rapport_impact,
  } = body;

  if (
    !nom ||
    !adresse ||
    !region ||
    !ville ||
    !contact_email ||
    !description_rapport_impact
  ) {
    return NextResponse.json(
      { error: 'Champs obligatoires manquants' },
      { status: 422 },
    );
  }

  if (
    typeof description_rapport_impact === 'string' &&
    description_rapport_impact.length < 30
  ) {
    return NextResponse.json(
      {
        error:
          'description_rapport_impact doit contenir au moins 30 caractères',
      },
      { status: 422 },
    );
  }

  // SIREN non obligatoire (arbitrage Val 2026-07-02) mais 9 chiffres si fourni.
  if (
    typeof body.siren === 'string' &&
    body.siren !== '' &&
    !/^\d{9}$/.test(body.siren)
  ) {
    return NextResponse.json(
      { error: 'siren doit contenir 9 chiffres' },
      { status: 422 },
    );
  }

  // Géocodage en background au save (§5 Associations « Adresse + géocodage auto »),
  // fail-open — cf. packages/plateforme/src/lib/geocoding.ts.
  const coords = await geocodeAdresse(adresse as string, '', ville as string);

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('associations')
    .insert({
      nom,
      adresse,
      region,
      ville,
      contact_email,
      description_rapport_impact,
      capacite_max_beneficiaires: body.capacite_max_beneficiaires ?? null,
      types_aliments_acceptes: body.types_aliments_acceptes ?? null,
      horaires_ouverture: body.horaires_ouverture ?? null,
      contact_nom: body.contact_nom ?? null,
      contact_telephone: body.contact_telephone ?? null,
      habilitee_attestation_fiscale:
        body.habilitee_attestation_fiscale ?? false,
      date_expiration_habilitation: body.date_expiration_habilitation ?? null,
      commentaires_internes: body.commentaires_internes ?? null,
      instructions_acces: body.instructions_acces ?? null,
      logo_url: body.logo_url ?? null,
      siren: body.siren ?? null,
      id_point_collecte_mts1: body.id_point_collecte_mts1 ?? null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'associations',
    record_id: (data as { id: string }).id,
    action: 'INSERT',
    user_id: auth.ctx.userId,
    new_values: data,
  });

  return NextResponse.json(data, { status: 201 });
}
