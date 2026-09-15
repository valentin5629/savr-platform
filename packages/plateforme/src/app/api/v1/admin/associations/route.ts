import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { requireStaff } from '@/lib/api-auth.js';
import { champsAdminPoses } from '@/lib/associations-champs-admin.js';
import { sanitizeOrTerm, serverError } from '@/lib/api-helpers.js';
import { geocodeAdresse } from '@/lib/geocoding.js';
import { jourParis } from '@savr/shared/src/temps/index.js';

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
  if (error) return serverError(error, 'admin.associations.list');

  // KPI par ligne — collectes AG réalisées (realisee + cloturee) rattachées via
  // attributions_antgaspi.association_id, sur les 30 derniers jours. Une seule
  // requête agrégée pour toute la page (≤ 50 assos, pas de N+1), comptée par asso.
  const rows = (data ?? []) as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const cutoff30j = jourParis(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
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

  // Champs admin-only à la CRÉATION (§06.06 §5 l.425-426, symétrique du PATCH) :
  // l'insert ci-dessous accepte `siren`, `habilitee_attestation_fiscale`,
  // `date_expiration_habilitation` et `id_point_collecte_mts1` — tous réservés
  // admin_savr. La route n'était gardée que par requireStaff : un `ops_savr`
  // pouvait POSER à la création ce que le PATCH lui refuse (403), et aucune
  // barrière DB ne rattrape (écriture en service_role → f_app_role() NULL →
  // trg_ops_immutable_cols s'exempte ; et il est BEFORE UPDATE de toute façon).
  // Autorisation AVANT toute validation de champ et tout appel externe : un rôle
  // qui n'a pas le droit d'écrire ces colonnes n'a pas à en recevoir le détail de
  // validation, et une requête rejetée ne doit pas appeler l'API adresse.
  // Seule une valeur réellement posée bloque — cf. champsAdminPoses.
  if (auth.ctx.role !== 'admin_savr') {
    const poses = champsAdminPoses(body);
    if (poses.length > 0) {
      return NextResponse.json(
        { error: 'Champs réservés admin : ' + poses.join(', ') },
        { status: 403 },
      );
    }
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
      // `=== true` et non `?? false` : `''` est neutre pour la garde admin-only
      // (cf. champsAdminPoses) donc il arrive jusqu'ici, et `''::boolean` remonterait
      // un 500 PG brut au client. Seul le booléen `true` vaut habilitation posée.
      habilitee_attestation_fiscale:
        body.habilitee_attestation_fiscale === true,
      // `|| null` et non `?? null` sur les 3 colonnes admin-only textuelles/date :
      // `''` n'est PAS une valeur posée (cf. champsAdminPoses) donc la garde le
      // laisse passer — il doit alors devenir NULL, sinon ops écrirait bel et bien
      // `''` dans une colonne admin-only et `''::date` renverrait un 500 PG brut.
      // Même traitement que `numero_rup` (#299) et que « vide = effacement » du PATCH.
      date_expiration_habilitation:
        (body.date_expiration_habilitation as string | null) || null,
      commentaires_internes: body.commentaires_internes ?? null,
      instructions_acces: body.instructions_acces ?? null,
      logo_url: body.logo_url ?? null,
      siren: (body.siren as string | null) || null,
      // N° RUP facultatif (CDC §04 associations.numero_rup / §06.06 §5) — source de
      // l'instantané attestations_don.association_numero_rup. '' ⇒ NULL (pas de RUP).
      numero_rup: (body.numero_rup as string | null) || null,
      id_point_collecte_mts1:
        (body.id_point_collecte_mts1 as string | null) || null,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
    })
    .select()
    .single();

  if (error) return serverError(error, 'admin.associations.create');

  await supabase.from('audit_log').insert({
    table_name: 'associations',
    record_id: (data as { id: string }).id,
    action: 'INSERT',
    user_id: auth.ctx.userId,
    new_values: data,
  });

  return NextResponse.json(data, { status: 201 });
}
