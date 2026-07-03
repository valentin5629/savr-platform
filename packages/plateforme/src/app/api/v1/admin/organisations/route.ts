import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const actif = searchParams.get('actif');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  // NB : PAS d'embed `evenements` ici. `evenements` a DEUX FK vers
  // `organisations` (`organisation_id` + `client_organisateur_organisation_id`)
  // → un embed non désambiguïsé renvoie un HTTP 300 `PGRST201` (« ambiguous
  // relationship ») qui faisait échouer TOUTE la liste Clients (« 0 organisation »
  // alors que la base en contient). L'ancien `collectes_zd:evenements!inner(...)`
  // était en plus **du code mort** (jamais lu dans le mapping ci-dessous — les
  // compteurs ZD/AG viennent de la RPC `count_collectes_par_org`). Vérifié contre
  // savr-dev : HTTP 206 + 14 organisations.
  let query = supabase
    .from('organisations')
    .select(
      `
      id, raison_sociale, type, siret, actif, logo_url, est_shadow, created_at,
      users:users(count)
    `,
      { count: 'exact' },
    )
    .order('raison_sociale')
    .range(offset, offset + limit - 1);

  if (type) query = query.eq('type', type);
  if (actif !== null) query = query.eq('actif', actif === 'true');

  const { data: orgs, error, count } = await query;
  if (error) {
    return serverError(error, 'admin.organisations.list');
  }

  // Nb collectes ZD/AG 12 derniers mois via requête séparée pour performance
  const orgIds = (orgs ?? []).map((o) => o.id as string);
  let statsZd: Record<string, number> = {};
  let statsAg: Record<string, number> = {};

  if (orgIds.length > 0) {
    const depuis12m = new Date();
    depuis12m.setFullYear(depuis12m.getFullYear() - 1);
    const depuis12mStr = depuis12m.toISOString().slice(0, 10);

    const [zdRes, agRes] = await Promise.all([
      supabase.rpc('count_collectes_par_org', {
        type_collecte: 'zd',
        depuis: depuis12mStr,
      }),
      supabase.rpc('count_collectes_par_org', {
        type_collecte: 'ag',
        depuis: depuis12mStr,
      }),
    ]);

    if (zdRes.data) {
      statsZd = Object.fromEntries(
        (zdRes.data as { organisation_id: string; nb: number }[]).map((r) => [
          r.organisation_id,
          r.nb,
        ]),
      );
    }
    if (agRes.data) {
      statsAg = Object.fromEntries(
        (agRes.data as { organisation_id: string; nb: number }[]).map((r) => [
          r.organisation_id,
          r.nb,
        ]),
      );
    }
  }

  const rows = (orgs ?? []).map((o) => ({
    id: o.id,
    raison_sociale: o.raison_sociale,
    type: o.type,
    siret: o.siret,
    actif: o.actif,
    logo_url: o.logo_url,
    nb_users: Array.isArray(o.users)
      ? ((o.users[0] as { count: number })?.count ?? 0)
      : 0,
    nb_collectes_zd_12m: statsZd[o.id as string] ?? 0,
    nb_collectes_ag_12m: statsAg[o.id as string] ?? 0,
  }));

  return NextResponse.json({ data: rows, total: count ?? 0, page, limit });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const {
    raison_sociale,
    type,
    siret,
    email_principal,
    telephone,
    adresse,
    code_postal,
    ville,
  } = body as {
    raison_sociale?: string;
    type?: string;
    siret?: string;
    email_principal?: string;
    telephone?: string;
    adresse?: string;
    code_postal?: string;
    ville?: string;
  };

  if (!raison_sociale || !type) {
    return NextResponse.json(
      { error: 'raison_sociale et type sont obligatoires' },
      { status: 422 },
    );
  }

  const TYPES_VALIDES = [
    'traiteur',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ];
  if (!TYPES_VALIDES.includes(type)) {
    return NextResponse.json({ error: 'type invalide' }, { status: 422 });
  }

  const supabase = createAdminSupabaseClient();
  const { data: org, error } = await supabase
    .from('organisations')
    .insert({
      raison_sociale,
      type,
      siret,
      email_principal,
      telephone,
      adresse,
      code_postal,
      ville,
    })
    .select('id, raison_sociale, type, actif')
    .single();

  if (error) {
    return writeError(error, 'admin.organisations.create');
  }

  return NextResponse.json(org, { status: 201 });
}
