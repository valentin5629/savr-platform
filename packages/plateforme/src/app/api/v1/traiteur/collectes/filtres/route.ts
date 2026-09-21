import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError } from '@/lib/api-helpers.js';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

/**
 * GET /api/v1/traiteur/collectes/filtres — options des filtres de la liste
 * Collectes (§06.04 §3 « Filtres disponibles », BL-P2-14 volet filtres) :
 * Lieu, Client organisateur, « Programmée par ». Les filtres Statut / Période /
 * « Info incomplète » n'ont pas besoin d'options (valeurs fermées).
 *
 * Périmètre : les options sont DÉRIVÉES des collectes que l'appelant voit déjà
 * (requête RLS-scopée sous son identité, `createSupabaseServerClient`). Une option
 * ne peut donc désigner qu'une entité RATTACHÉE À UNE COLLECTE QU'IL LISTE — mais
 * attention, ce n'est PAS la même chose que « une donnée qu'il pourrait lire lui-même » :
 * le NOM d'une organisation tierce ne lui est pas lisible (cf. plus bas), il est
 * résolu ici en service_role et borné à ces seuls ids. Manager et commercial voient
 * le même périmètre en lecture (révision CDC 2026-05-29).
 *
 * ⚠ Le garde-fou RÉEL de cette route est l'embed `evenements!inner` : c'est lui qui
 * ramène le périmètre de `col_select` (large : événement possédé OU opéré OU client
 * organisateur OU lieu rattaché) à celui de `evt_manager_select` / `evt_commercial_select`
 * (organisation possédante OU traiteur opérationnel). Si ces policies étaient un jour
 * élargies, cette route exfiltrerait automatiquement les noms correspondants SANS
 * qu'une ligne de son code ne change. Toute évolution de `evt_*_select` doit donc
 * repasser ici. La borne du service_role vit dans le code (une RLS ne peut pas la
 * prouver, le service_role la contournant par définition). Elle a DEUX filets, et
 * ils couvrent deux choses différentes — garder les deux :
 * `R25a/options_service_role_borne_aux_ids_du_perimetre` (la borne `.in()` elle-même)
 * et `R25a/options_sans_tiers_aucun_appel_service_role` (la 1re lecture reste sous RLS).
 *
 * « Client organisateur » est keyé sur `evenements.nom_client_organisateur` (et NON
 * sur `client_organisateur_organisation_id`) : ce dernier est un RATTACHEMENT
 * réservé à l'Admin (il ouvre un accès en lecture, cf. EVENT_LOCKED_FIELDS de
 * `programmation/evenements/[id]`) et reste donc NULL sur les événements programmés
 * par un traiteur, alors que le nom est obligatoire à la confirmation
 * (`programmation/evenements` POST). Le nom est le seul libellé réellement peuplé.
 *
 * « Programmée par » a besoin du NOM d'organisations TIERCES (agence /
 * gestionnaire de lieux qui programment pour le traiteur opérationnel). Les
 * policies `org_manager_select` / `org_commercial_select` limitent le traiteur à sa
 * propre organisation → l'embed PostgREST rendrait NULL. Aucune policy n'est
 * élargie (CLAUDE.md §12) : les noms sont résolus en service_role, STRICTEMENT
 * bornés aux ids sortis de la requête RLS-scopée ci-dessus.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const orgId = auth.ctx.organisationId;
  const supabase = createSupabaseServerClient();

  // Périmètre visible de l'appelant (RLS `col_select`) — aucune borne de date : les
  // options doivent couvrir l'onglet Historique autant que Programmées.
  // `max_rows = 1000` (supabase/config.toml) tronque SILENCIEUSEMENT au-delà du
  // millier. Sans `order`, le sous-ensemble retenu serait non déterministe et les
  // options varieraient d'un appel à l'autre. On ordonne par date DÉCROISSANTE (et
  // non par `id`, un uuid aléatoire) : la troncature garde alors les collectes les
  // plus RÉCENTES, dont les lieux et clients sont les plus susceptibles d'être ceux
  // que l'utilisateur cherche à filtrer. Volumes V1 (~150 collectes/mois toutes
  // orgas) très en deçà, mais la migration Bubble injecte ~1 675 collectes
  // historiques : un gros traiteur peut s'en approcher.
  const { data, error } = await supabase
    .from('collectes')
    .select(
      `id,
       evenements!inner(
         organisation_id, nom_client_organisateur,
         lieux!lieu_id(id, nom)
       )`,
    )
    .order('date_collecte', { ascending: false });
  if (error) return serverError(error, 'traiteur.collectes.filtres.list');

  interface Lieu {
    id: string;
    nom: string | null;
  }
  interface Evt {
    organisation_id: string;
    nom_client_organisateur: string | null;
    lieux: Lieu | Lieu[] | null;
  }
  const one = <T>(v: T | T[] | null): T | null =>
    !v ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  // Limite LEVÉE le 2026-09-21 (migration 20260921140000_plateforme_lieux_select_
  // traiteur_operationnel, arbitrage Val) : `lieux_clients_select` porte désormais une
  // 4e branche « je suis le traiteur opérationnel ». Sur une collecte programmée par un
  // tiers, l'embed `lieux!lieu_id` rend le lieu au lieu de null — l'option apparaît donc
  // dans le filtre. Auparavant la collecte restait listée mais son lieu était invisible
  // (ligne « Lieu » à « — »), seulement quand le traiteur n'avait aucun AUTRE lien vers
  // ce lieu (ni lieu rattaché, ni événement qu'il a lui-même programmé là-bas).
  // La 4e branche est bornée par son propre prédicat (`traiteur_operationnel_organisation_id
  // = mon organisation`) et par un test de rôle explicite — et NON par le périmètre de
  // `evt_*_select` : si ces policies s'élargissaient, la branche ne suivrait pas. Étendue
  // prouvée par supabase/tests/lieux_traiteur_operationnel.test.sql.
  const lieux = new Map<string, string>();
  const clients = new Set<string>();
  const progIds = new Set<string>();

  for (const row of (data ?? []) as unknown as { evenements: Evt | Evt[] }[]) {
    const evt = one(row.evenements);
    if (!evt) continue;
    const lieu = one(evt.lieux);
    if (lieu?.id && !lieux.has(lieu.id)) lieux.set(lieu.id, lieu.nom ?? 'Lieu');
    const nomClient = evt.nom_client_organisateur?.trim();
    if (nomClient) clients.add(nomClient);
    if (evt.organisation_id) progIds.add(evt.organisation_id);
  }

  // « Programmée par » : l'organisation de l'appelant porte le libellé CDC « Mon
  // organisation » ; les tierces sont nommées « Agence : X » / « Gestionnaire : X »
  // côté client, à partir du type renvoyé ici.
  const tiersIds = [...progIds].filter((id) => id !== orgId);
  const nomsTiers = new Map<string, { nom: string; type: string | null }>();
  if (tiersIds.length > 0) {
    const admin = createAdminSupabaseClient();
    const { data: orgs, error: orgErr } = await admin
      .from('organisations')
      .select('id, nom, type')
      .in('id', tiersIds);
    if (orgErr)
      return serverError(orgErr, 'traiteur.collectes.filtres.orgs_tierces');
    for (const o of (orgs ?? []) as { id: string; nom: string; type: string }[])
      nomsTiers.set(o.id, { nom: o.nom, type: o.type });
  }

  const programmateurs = [
    ...(progIds.has(orgId)
      ? [{ id: orgId, nom: 'Mon organisation', type: null as string | null }]
      : []),
    ...tiersIds
      .map((id) => ({
        id,
        nom: nomsTiers.get(id)?.nom ?? 'Organisation',
        type: nomsTiers.get(id)?.type ?? null,
      }))
      .sort((a, b) => a.nom.localeCompare(b.nom)),
  ];

  return NextResponse.json({
    data: {
      lieux: [...lieux.entries()]
        .map(([id, nom]) => ({ id, nom }))
        .sort((a, b) => a.nom.localeCompare(b.nom)),
      clients: [...clients].sort((a, b) => a.localeCompare(b)),
      programmateurs,
    },
  });
}
