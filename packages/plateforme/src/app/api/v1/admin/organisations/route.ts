import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, writeError, withApiTrace } from '@/lib/api-helpers.js';
import { jourParis } from '@savr/shared/src/temps/index.js';

async function getHandler(req: NextRequest): Promise<NextResponse> {
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
  let packsActifs: Record<
    string,
    { type_pack: string; credits_restants: number }
  > = {};

  if (orgIds.length > 0) {
    const depuis12m = new Date();
    depuis12m.setFullYear(depuis12m.getFullYear() - 1);
    const depuis12mStr = jourParis(depuis12m);

    const [zdRes, agRes, packsRes] = await Promise.all([
      supabase.rpc('count_collectes_par_org', {
        type_collecte: 'zd',
        depuis: depuis12mStr,
      }),
      supabase.rpc('count_collectes_par_org', {
        type_collecte: 'ag',
        depuis: depuis12mStr,
      }),
      // Pack AG actif par organisation. Invariant métier : au plus 1 pack
      // `statut='actif'` par org (uniq_pack_actif_par_org, CDC §05). Requête
      // séparée filtrée aux orgs de la page (même pattern que les stats ZD/AG).
      supabase
        .from('packs_antgaspi')
        .select(
          'organisation_id, type_pack, credits_initiaux, credits_consommes',
        )
        .eq('statut', 'actif')
        .in('organisation_id', orgIds),
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
    if (packsRes.data) {
      packsActifs = Object.fromEntries(
        (
          packsRes.data as {
            organisation_id: string;
            type_pack: string;
            credits_initiaux: number;
            credits_consommes: number;
          }[]
        ).map((p) => [
          p.organisation_id,
          {
            type_pack: p.type_pack,
            credits_restants: p.credits_initiaux - p.credits_consommes,
          },
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
    pack_actif: packsActifs[o.id as string] ?? null,
  }));

  return NextResponse.json({ data: rows, total: count ?? 0, page, limit });
}

async function postHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  // ALLOWLIST de colonnes RÉELLES de `plateforme.organisations` (18 colonnes,
  // vérifiées contre information_schema). `code_postal` / `ville` étaient lus du
  // body et poussés dans l'INSERT alors qu'ils N'EXISTENT PAS sur la table →
  // PostgREST PGRST204 à CHAQUE création d'organisation par le staff (route
  // morte, relevé revue #302). L'adresse postale détaillée a pour source de
  // vérité `plateforme.entites_facturation` (`adresse_facturation`,
  // `code_postal`, `ville`) ; le CDC §06.06 §8 ne la demande pas à la création
  // d'organisation (elle se saisit dans l'onglet « Informations légales » via
  // les entités de facturation) → les champs sont simplement ignorés ici.
  // Même constat déjà documenté sur la route sœur `[id]/route.ts`.
  const {
    raison_sociale,
    nom,
    type,
    siret,
    email_principal,
    telephone,
    adresse,
  } = body as {
    raison_sociale?: string;
    nom?: string;
    type?: string;
    siret?: string;
    email_principal?: string;
    telephone?: string;
    adresse?: string;
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
  ] as const;
  type OrganisationType = (typeof TYPES_VALIDES)[number];
  // `as const` + garde de type : le payload d'INSERT est ainsi entièrement
  // typable contre le schéma réel. Sans ce narrowing, `type: string` fait
  // échouer l'assignation AVANT l'excess-property-check et rend le gate
  // `check:column-db` AVEUGLE aux colonnes fantômes de cet INSERT — c'est
  // exactement pourquoi il n'avait pas vu `code_postal`/`ville`.
  if (!(TYPES_VALIDES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: 'type invalide' }, { status: 422 });
  }
  const typeOrga = type as OrganisationType;

  const supabase = createAdminSupabaseClient();
  const { data: org, error } = await supabase
    .from('organisations')
    .insert({
      // `nom` = nom usuel, NOT NULL sans default : sans lui l'INSERT viole
      // 23502. Le back-office ne collecte que la raison sociale → fallback
      // `nom = raison_sociale` (même règle qu'à l'inscription, §04 Data Model).
      nom: nom ?? raison_sociale,
      raison_sociale,
      type: typeOrga,
      siret,
      email_principal,
      telephone,
      adresse,
    })
    .select('id, nom, raison_sociale, type, actif')
    .single();

  if (error) {
    return writeError(error, 'admin.organisations.create');
  }

  return NextResponse.json(org, { status: 201 });
}

export const GET = withApiTrace(getHandler);
export const POST = withApiTrace(postHandler);
