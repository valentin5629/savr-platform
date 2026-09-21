import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import {
  requireProgrammateurOuAdmin,
  createSupabaseServerClient,
} from '@/lib/api-auth.js';
import { sanitizeOrTerm, serverError } from '@/lib/api-helpers.js';
import { geocodeAdresse } from '@/lib/geocoding.js';

// Projection de l'autocomplétion. Les 12 colonnes appartiennent toutes à la liste
// blanche `v_lieux_clients` / au GRANT colonne de `authenticated` (mesuré) ; les 5
// colonnes admin/ops-only (commentaire_lieu, siren, email_gestionnaire,
// reference_citeo, commentaires_internes) en sont absentes et le resteront : sur la
// vue, en ajouter une ici casserait la requête au lieu de la laisser fuir.
const COLONNES_AUTOCOMPLETION = `id, nom, adresse_acces, code_postal, ville, acces_details,
   acces_office, stationnement, type_vehicule_max,
   controle_acces_requis_default, contraintes_horaires, flux_autorises`;

/**
 * GET /api/v1/programmation/lieux — options du combobox Lieu (étape 2 du
 * formulaire de programmation, §06.01).
 *
 * ── Rôle client : lecture SOUS RLS, la policy fait foi ──
 * `v_lieux_clients` est SECURITY INVOKER : c'est `lieux_clients_select` qui borne
 * les lignes, et elle est désormais la SEULE expression du périmètre. La route ne
 * recopie plus ses branches en TypeScript — toute évolution de la policy atteint
 * l'autocomplétion sans qu'une ligne change ici.
 *
 * Pourquoi la lecture n'est plus en service_role : elle n'a jamais eu besoin de
 * bypasser la RLS. Le service_role n'était requis que par le chemin d'admin support
 * ci-dessous, et le garder pour le client obligeait à recopier la policy. Cette
 * copie avait déjà divergé : elle n'implémentait que les branches 1 et 2, si bien
 * qu'un traiteur ne se voyait pas proposer le lieu d'un événement programmé POUR
 * lui par une agence ou un gestionnaire (branche 4, migration 20260921140000).
 *
 * ── Admin support (§06.01 l.15) : service_role, et pourquoi il reste nécessaire ──
 * L'admin programme POUR une organisation cible passée en `?organisation_id=`. Sa
 * propre RLS (`lieux_admin`) lui donne TOUS les lieux, jamais le périmètre de la
 * cible : simuler l'identité d'un tiers est impossible sous RLS. D'où le miroir
 * explicite du prédicat, branche par branche. Le param cross-org n'est lu QUE dans
 * cette branche — un rôle client ne peut pas élargir son scope avec.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = sanitizeOrTerm(searchParams.get('q') ?? ''); // C2 : neutralise l'injection .or
  const filtreTexte = `nom.ilike.%${q}%,adresse_acces.ilike.%${q}%,ville.ilike.%${q}%`;

  if (!auth.ctx.isAdmin) {
    const supabase = createSupabaseServerClient();
    let query = supabase
      .from('v_lieux_clients')
      .select(COLONNES_AUTOCOMPLETION)
      .eq('actif', true)
      .order('nom')
      .limit(20);
    if (q) query = query.or(filtreTexte);

    const { data, error } = await query;
    if (error) return serverError(error, 'programmation.lieux.list');
    return NextResponse.json(data ?? []);
  }

  // Sans org cible → 0 résultat (comme un traiteur vierge), jamais « tous les lieux ».
  const orgId = searchParams.get('organisation_id');
  if (!orgId) return NextResponse.json([]);

  const supabase = createAdminSupabaseClient();

  // Miroir de `lieux_clients_select` pour l'organisation cible. Les branches sont
  // reprises une à une, dans l'ordre de la policy :
  //   b1 — lieu rattaché à l'organisation (organisations_lieux) ;
  //   b2 — lieu d'un événement que l'organisation a programmé ;
  //   b4 — lieu d'un événement que l'organisation OPÈRE (20260921140000).
  // La branche 3 (client organisateur, événement daté) est volontairement absente :
  // elle est INATTEIGNABLE pour les rôles de cette route. Mesuré : le sous-SELECT
  // d'une policy subit la RLS de la table interne, et aucune policy `evt_*_select`
  // ne donne à un traiteur / une agence / un gestionnaire un événement où il n'est
  // QUE client organisateur — seul `evt_client_orga_select` le fait, or
  // `client_organisateur` n'est pas un rôle programmateur.
  // Ce miroir borne un confort d'UI, pas un accès : l'admin lit déjà tous les lieux
  // (`lieux_admin`). Son enjeu est que l'admin voie la MÊME liste que sa cible.
  const [{ data: orgLieux }, { data: evtProgrammes }, { data: evtOperes }] =
    await Promise.all([
      supabase
        .from('organisations_lieux')
        .select('lieu_id')
        .eq('organisation_id', orgId),
      supabase
        .from('evenements')
        .select('lieu_id')
        .eq('organisation_id', orgId)
        .not('lieu_id', 'is', null),
      supabase
        .from('evenements')
        .select('lieu_id')
        .eq('traiteur_operationnel_organisation_id', orgId)
        .not('lieu_id', 'is', null),
    ]);

  const uniqueIds = [
    ...new Set(
      [...(orgLieux ?? []), ...(evtProgrammes ?? []), ...(evtOperes ?? [])].map(
        (r: { lieu_id: string | null }) => r.lieu_id as string,
      ),
    ),
  ].filter(Boolean);

  if (uniqueIds.length === 0) return NextResponse.json([]);

  let query = supabase
    .from('lieux')
    .select(COLONNES_AUTOCOMPLETION)
    .eq('actif', true)
    .in('id', uniqueIds)
    .order('nom')
    .limit(20);
  if (q) query = query.or(filtreTexte);

  const { data, error } = await query;
  if (error) return serverError(error, 'programmation.lieux.list');

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const body = (await req.json()) as Record<string, unknown>;
  const { nom, adresse_acces, code_postal, ville } = body;

  if (!nom || !adresse_acces || !code_postal || !ville) {
    return NextResponse.json(
      { error: 'Champs obligatoires : nom, adresse_acces, code_postal, ville' },
      { status: 422 },
    );
  }

  // Géocodage en background au save, fail-open — cf. lib/geocoding.ts.
  const coords = await geocodeAdresse(
    String(adresse_acces),
    String(code_postal),
    String(ville),
  );

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('lieux')
    .insert({
      nom: String(nom),
      adresse_acces: String(adresse_acces),
      code_postal: String(code_postal),
      ville: String(ville),
      actif: false,
      stationnement: body.stationnement ?? null,
      type_vehicule_max: body.type_vehicule_max ?? 'camionnette',
      acces_office: body.acces_office ?? null,
      acces_details: body.acces_details ?? null,
      controle_acces_requis_default: false,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
    })
    .select('id, nom, adresse_acces, code_postal, ville, actif')
    .single();

  if (error) return serverError(error, 'programmation.lieux.create');

  // Action "Normaliser un lieu" (§06 Back-office Admin) : le lieu saisi manuellement
  // est créé actif=false, l'Admin est notifié pour vérifier/compléter/valider.
  // L'org sert uniquement au libellé de la notification (best-effort). Admin support :
  // org cible via body.organisation_id (staff-only) ; absente → libellé vide, non bloquant.
  const notifOrgId = auth.ctx.isAdmin
    ? body.organisation_id
      ? String(body.organisation_id)
      : null
    : auth.ctx.organisationId;
  const [{ data: user }, orgRes] = await Promise.all([
    supabase
      .from('users')
      .select('prenom, nom')
      .eq('id', auth.ctx.userId)
      .maybeSingle(),
    notifOrgId
      ? supabase
          .from('organisations')
          .select('nom')
          .eq('id', notifOrgId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const org = orgRes.data;
  const lieu = data as { id: string; nom: string; adresse_acces: string };
  void sendEmail('admin_demande_ajout_lieu', 'hello@gosavr.io', {
    lieu_nom: lieu.nom,
    lieu_adresse: lieu.adresse_acces,
    user_nom: user
      ? `${(user as { prenom: string }).prenom} ${(user as { nom: string }).nom}`
      : '',
    organisation_nom: (org as { nom?: string } | null)?.nom ?? '',
    date_collecte: '',
    lien_lieu: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/admin/lieux/${lieu.id}`,
  }).catch(() => null);

  return NextResponse.json(data, { status: 201 });
}
