import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import {
  requireProgrammateurOuAdmin,
  createSupabaseServerClient,
} from '@/lib/api-auth.js';
import { sanitizeOrTerm, serverError } from '@/lib/api-helpers.js';
import { geocodeAdresse } from '@/lib/geocoding.js';

// Colonnes proposées par l'autocomplétion — sous-ensemble de la liste blanche
// `v_lieux_clients` (les champs admin-only restent hors de portée côté client).
const COLONNES_LIEU = `id, nom, adresse_acces, code_postal, ville, acces_details,
   acces_office, stationnement, type_vehicule_max,
   controle_acces_requis_default, contraintes_horaires, flux_autorises`;

function filtreRecherche<T extends { or: (f: string) => T }>(
  query: T,
  q: string,
): T {
  return q
    ? query.or(`nom.ilike.%${q}%,adresse_acces.ilike.%${q}%,ville.ilike.%${q}%`)
    : query;
}

// GET /api/v1/programmation/lieux — autocomplétion Lieux du formulaire (§06.01).
//
// Deux chemins, pour deux identités :
//
//  • RÔLE CLIENT → lecture sous `authenticated` : c'est la policy
//    `lieux_clients_select` qui filtre, et elle seule. Le prédicat n'est PAS
//    re-transcrit ici. Auparavant la route lisait en service_role et
//    reproduisait 2 des 4 branches à la main : la branche « traiteur
//    opérationnel » (§09, arbitrage Val 2026-09-21, migration
//    20260921140000) n'atteignait donc pas l'autocomplétion — un traiteur qui
//    OPÈRE une collecte chez un lieu ne le retrouvait pas ici, alors que la
//    fiche événement le lui montrait. Toute branche future suit désormais
//    automatiquement.
//    ⚠ Reproduire ce prédicat à la main est en réalité hors de portée : dans une
//    policy, la RLS de la table interne filtre AUSSI le sous-SELECT, donc
//    l'ensemble visible est l'intersection avec `evt_*_select`, qui est gardée
//    par rôle. Seule la base peut trancher juste.
//
//  • ADMIN SUPPORT (§06.01 l.15) → service_role, `?organisation_id=` (param
//    cross-org réservé au staff — un client ne peut jamais élargir son scope).
//    La RLS ne peut PAS servir ce cas : pour un admin, `lieux_clients_select`
//    ne s'applique pas (garde `f_app_role() <> ALL(admin_savr, ops_savr)`) et
//    `lieux_admin` lui donnerait TOUS les lieux, au lieu du périmètre de l'org
//    cible. Le filtre reste donc transcrit, et doit rester aligné sur la policy
//    — verrouillé par le cliquet pgTAP `lieux_clients_select_cliquet.test.sql`,
//    qui casse si la policy change sans que ce chemin suive.
//    Enjeu d'ERGONOMIE, pas de sécurité : l'admin lit déjà tous les lieux.
//    Sans org cible → 0 résultat (comme un traiteur vierge).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireProgrammateurOuAdmin(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const q = sanitizeOrTerm(searchParams.get('q') ?? ''); // C2 : neutralise l'injection .or

  return auth.ctx.isAdmin
    ? lieuxDeLOrgCible(searchParams.get('organisation_id'), q)
    : lieuxDuDemandeur(q);
}

// Rôle client : la RLS est la seule source de vérité.
async function lieuxDuDemandeur(q: string): Promise<NextResponse> {
  const supabase = createSupabaseServerClient();

  const { data, error } = await filtreRecherche(
    supabase
      .from('v_lieux_clients')
      .select(COLONNES_LIEU)
      .eq('actif', true)
      .order('nom')
      .limit(20),
    q,
  );

  if (error) return serverError(error, 'programmation.lieux.list');
  return NextResponse.json(data ?? []);
}

// Admin support : « les lieux que verrait l'organisation cible ». Transcription
// des branches de `lieux_clients_select` qui sont EFFECTIVES pour les rôles
// atteignant cette route (cf. PROGRAMMATION_ROLES).
//
// La branche « client organisateur » n'est volontairement PAS transcrite : elle
// n'ajoute aucun lieu pour ces rôles. Attention au motif exact — son
// sous-SELECT PEUT rendre des lignes (mesuré : `gestionnaire_lieux` et
// `traiteur_manager`). Les policies de `evenements` sont PERMISSIVE, donc
// OR'ées : la garde de rôle de `evt_client_orga_select` n'empêche pas une
// policy voisine de rendre le même événement. Ce qui est vrai, c'est que tout
// `lieu_id` atteint par cette branche est DÉJÀ couvert par les branches 1, 2
// ou 4 — `evt_*_select` ne donne à ces rôles que `organisation_id = self`,
// `lieu_id ∈ mes lieux rattachés`, ou `traiteur_operationnel = self`.
// Équivalence des ensembles RLS ⇄ transcription mesurée sur les 4 rôles
// (0 écart dans les deux sens). L'ajouter rendrait l'admin PLUS large que sa
// cible.
async function lieuxDeLOrgCible(
  orgId: string | null,
  q: string,
): Promise<NextResponse> {
  if (!orgId) return NextResponse.json([]);

  const supabase = createAdminSupabaseClient();

  const [
    { data: org },
    { data: orgLieux },
    { data: evtLieux },
    { data: opLieux },
  ] = await Promise.all([
    supabase.from('organisations').select('type').eq('id', orgId).maybeSingle(),
    // Branche 1 — lieu rattaché à l'organisation.
    supabase
      .from('organisations_lieux')
      .select('lieu_id')
      .eq('organisation_id', orgId),
    // Branche 2 — lieu d'un événement que l'organisation a programmé.
    supabase
      .from('evenements')
      .select('lieu_id')
      .eq('organisation_id', orgId)
      .not('lieu_id', 'is', null),
    // Branche 4 — lieu d'un événement que l'organisation OPÈRE.
    supabase
      .from('evenements')
      .select('lieu_id')
      .eq('traiteur_operationnel_organisation_id', orgId)
      .not('lieu_id', 'is', null),
  ]);

  const ids = new Set<string>();
  for (const r of orgLieux ?? []) ids.add((r as { lieu_id: string }).lieu_id);
  for (const r of evtLieux ?? []) ids.add((r as { lieu_id: string }).lieu_id);

  // La policy garde la branche 4 par le rôle (traiteur_manager /
  // traiteur_commercial). Côté admin la cible est une ORGANISATION, pas un
  // utilisateur : on approxime la garde de rôle par le type d'organisation.
  // APPROXIMATION ASSUMÉE, pas un invariant : aucun CHECK ni trigger ne lie
  // `users.role` à `organisations.type` (vérifié — le seul trigger sur `users`
  // est `trg_users_block_role_escalation`). C'est une convention de données.
  // Si elle était prise en défaut, l'effet serait une sur- ou sous-proposition
  // dans cette liste — jamais une fuite : l'admin lit déjà tous les lieux.
  if ((org as { type?: string } | null)?.type === 'traiteur') {
    for (const r of opLieux ?? []) ids.add((r as { lieu_id: string }).lieu_id);
  }

  const uniqueIds = [...ids].filter(Boolean);
  if (uniqueIds.length === 0) return NextResponse.json([]);

  const { data, error } = await filtreRecherche(
    supabase
      .from('lieux')
      .select(COLONNES_LIEU)
      .eq('actif', true)
      .in('id', uniqueIds)
      .order('nom')
      .limit(20),
    q,
  );

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
