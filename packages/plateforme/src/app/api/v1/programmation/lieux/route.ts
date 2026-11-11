import { NextRequest, NextResponse } from 'next/server';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { adresseLieu } from '@/lib/notifications/traiteur-operationnel.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import {
  requireProgrammateurOuAdmin,
  createSupabaseServerClient,
} from '@/lib/api-auth.js';
import { sanitizeOrTerm, serverError } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';
import { geocodeAdresse } from '@/lib/geocoding.js';
import { regionDepuisCodePostal } from '@/lib/lieux/region-code-postal.js';
import { urlApplication } from '@/lib/url-application.js';
import {
  estGabaritLieuTransporteur,
  MESSAGE_GABARIT_INVALIDE,
} from '@/lib/lieux-labels';

// Colonnes proposées par l'autocomplétion — sous-ensemble de la liste blanche
// `v_lieux_clients` (les champs admin-only restent hors de portée côté client).
const COLONNES_LIEU = `id, nom, adresse_acces, code_postal, ville, acces_details,
   acces_office, stationnement, type_vehicule_max,
   controle_acces_requis_default, contraintes_horaires, flux_autorises`;

// Code site VIPARIS (Val 2026-11-02) : il décide si le formulaire propose le
// champ « Code affaire VIPARIS ». La colonne n'est pas dans la liste blanche de
// `v_lieux_clients` : elle est lue ici en service_role, pour les SEULS lieux que
// la lecture précédente a déjà rendus à l'appelant (rien d'autre n'est exposé).
async function avecCodeSiteViparis(
  lieux: Array<Record<string, unknown> & { id: string }>,
): Promise<NextResponse> {
  if (lieux.length === 0) return NextResponse.json([]);
  const { data, error } = await createAdminSupabaseClient()
    .from('lieux')
    .select('id, code_site_viparis')
    .in(
      'id',
      lieux.map((l) => l.id),
    )
    .not('code_site_viparis', 'is', null);
  if (error) return serverError(error, 'programmation.lieux.code_site');
  const codes = new Map(
    (data ?? []).map((r) => [
      (r as { id: string }).id,
      (r as { code_site_viparis: string }).code_site_viparis,
    ]),
  );
  return NextResponse.json(
    lieux.map((l) => ({ ...l, code_site_viparis: codes.get(l.id) ?? null })),
  );
}

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
//    cible. Le périmètre reste donc transcrit, côté BASE : la fonction
//    `f_lieux_visibles_organisation` (migration 20261111100000), tenue alignée
//    sur la policy par le cliquet pgTAP `lieux_clients_select_cliquet.test.sql`
//    et comparée à la lecture sous RLS, rôle par rôle, par
//    `programmation_lieux_visibles_organisation.test.sql`.
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
  return avecCodeSiteViparis(
    (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>,
  );
}

// Admin support : « les lieux que verrait l'organisation cible ».
//
// Le périmètre est calculé par la base : `f_lieux_visibles_organisation` rend
// les lieux rattachés à l'organisation, ceux des événements qu'elle a
// programmés et, pour un traiteur, ceux des événements qu'elle opère
// (transcription des branches de `lieux_clients_select`, motifs et limites dans
// la migration 20261111100000). La route lui applique ensuite les mêmes
// filtres que sur le chemin client : lieu actif, terme saisi, tri par nom,
// 20 lignes.
//
// Avant, la route relisait ici tous les événements de l'organisation puis
// passait tous ses lieux dans un seul `.in('id', …)`. L'API de données ampute
// une réponse à 1 000 lignes sans erreur et refuse un filtre de quelques
// centaines d'identifiants (mesures : lib/pdf/selection-par-pages.ts) : au-delà,
// des lieux manquaient dans les propositions, ou la recherche échouait. Les
// erreurs de ces lectures n'étaient pas lues non plus.
//
// Un identifiant mal formé est traité comme une organisation inconnue (aucun
// lieu) : la base refuserait de le lire comme un uuid, ce n'est pas une panne.
async function lieuxDeLOrgCible(
  orgId: string | null,
  q: string,
): Promise<NextResponse> {
  if (!orgId || !estUuid(orgId)) return NextResponse.json([]);

  const { data, error } = await filtreRecherche(
    createAdminSupabaseClient()
      .rpc('f_lieux_visibles_organisation', { p_organisation_id: orgId })
      .eq('actif', true),
    q,
  )
    .select(COLONNES_LIEU)
    .order('nom')
    .limit(20);

  if (error) return serverError(error, 'programmation.lieux.list');
  return avecCodeSiteViparis(
    (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>,
  );
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

  if (
    body.type_vehicule_max != null &&
    !estGabaritLieuTransporteur(body.type_vehicule_max)
  ) {
    return NextResponse.json(
      { error: MESSAGE_GABARIT_INVALIDE },
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
      // Sans elle l'algorithme d'attribution AG ne proposait rien (C1, Val 2026-11-03).
      region: regionDepuisCodePostal(String(code_postal)),
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
  const lieu = data as {
    id: string;
    nom: string;
    adresse_acces: string | null;
    code_postal: string | null;
    ville: string | null;
  };
  const u = user as { prenom?: string | null; nom?: string | null } | null;
  // Texte saisi interpolé tel quel dans le HTML du gabarit : échappé ici.
  void sendEmail('admin_demande_ajout_lieu', 'contact@gosavr.io', {
    lieu_nom: escapeHtml(lieu.nom),
    lieu_adresse: escapeHtml(adresseLieu(lieu)),
    user_nom: escapeHtml(
      [u?.prenom, u?.nom]
        .map((v) => (v ?? '').trim())
        .filter(Boolean)
        .join(' '),
    ),
    organisation_nom: escapeHtml((org as { nom?: string } | null)?.nom ?? ''),
    lien_lieu: urlApplication(req, `/admin/lieux/${lieu.id}`),
  }).catch(() => null);

  return NextResponse.json(data, { status: 201 });
}
