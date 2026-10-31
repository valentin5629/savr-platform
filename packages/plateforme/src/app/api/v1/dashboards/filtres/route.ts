import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import {
  lireParLots,
  lireParPages,
  TAILLE_PAGE,
} from '@/lib/pdf/selection-par-pages.js';

const ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'client_organisateur',
];

interface Option {
  id: string;
  nom: string;
}

interface LigneLue {
  id: string;
  evenements: Evt | Evt[] | null;
}
interface Evt {
  nom_client_organisateur: string | null;
  traiteur_operationnel_organisation_id: string | null;
  lieux:
    | { id: string; nom: string | null }
    | { id: string; nom: string | null }[]
    | null;
}

const un = <T>(v: T | T[] | null): T | null =>
  !v ? null : Array.isArray(v) ? (v[0] ?? null) : v;

const trie = (m: Map<string, string>): Option[] =>
  [...m.entries()]
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

/**
 * GET /api/v1/dashboards/filtres — options de la barre de filtres globale des
 * dashboards traiteur, agence (§06.04, §06.11 : Lieux, Client organisateur) et
 * client organisateur (Lieux, Traiteurs — décision Val du 2026-10-30), plus le
 * référentiel des types d'événement.
 *
 * Les options sont DÉRIVÉES des collectes des 24 derniers mois du périmètre du
 * dashboard (événements programmés par l'organisation, ou dont elle est le client
 * organisateur rattaché), lues sous l'identité de l'appelant : une option ne
 * désigne qu'un lieu, un client ou un traiteur d'une collecte qu'il voit déjà.
 * Collectes brouillon et annulées écartées (elles ne comptent dans aucun bloc).
 * Les noms de traiteur passent par la vue liste blanche `v_referentiel_traiteurs`
 * (comme la liste Collectes du client organisateur), jamais en service_role.
 * Le client organisateur d'un traiteur ou d'une agence est le NOM saisi à la
 * programmation (`evenements.nom_client_organisateur`, comme la liste Collectes) :
 * l'option a ce nom pour identifiant.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const organisateur = auth.ctx.role === 'client_organisateur';
  const supabase = createSupabaseServerClient();

  const depuis = new Date();
  depuis.setMonth(depuis.getMonth() - 24);

  const lu = await lireParPages<LigneLue>((apresId) => {
    let q = supabase
      .from('collectes')
      .select(
        `id,
         evenements!inner(organisation_id, client_organisateur_organisation_id,
           nom_client_organisateur, traiteur_operationnel_organisation_id,
           lieux!lieu_id(id, nom))`,
      )
      .eq(
        organisateur
          ? 'evenements.client_organisateur_organisation_id'
          : 'evenements.organisation_id',
        auth.ctx.organisationId,
      )
      .gte('date_collecte', jourParis(depuis))
      // Brouillons et annulées ne comptent dans aucun bloc : leurs lieux ou
      // clients ne donneraient qu'un dashboard vide.
      .not('statut', 'in', '(brouillon,annulee)');
    if (apresId) q = q.gt('id', apresId);
    return q.limit(TAILLE_PAGE).order('id', { ascending: true });
  });
  if (lu.error) return serverError(lu.error, 'dashboards.filtres.collectes');

  const lieux = new Map<string, string>();
  const clients = new Map<string, string>();
  const traiteurIds = new Set<string>();
  for (const ligne of lu.data) {
    const evt = un(ligne.evenements);
    if (!evt) continue;
    const lieu = un(evt.lieux);
    if (lieu?.id) lieux.set(lieu.id, lieu.nom ?? 'Lieu');
    // Identifiant = nom tel que saisi (le filtre est une égalité exacte),
    // libellé débarrassé de ses espaces.
    const client = evt.nom_client_organisateur;
    if (client?.trim()) clients.set(client, client.trim());
    if (evt.traiteur_operationnel_organisation_id)
      traiteurIds.add(evt.traiteur_operationnel_organisation_id);
  }

  const { data: types, error: erreurTypes } = await supabase
    .from('types_evenements')
    .select('id, libelle')
    .eq('actif', true)
    .order('ordre_affichage', { ascending: true });
  if (erreurTypes) return serverError(erreurTypes, 'dashboards.filtres.types');

  const data: Record<string, unknown> = {
    lieux: trie(lieux),
    types: (types ?? []).map((t) => ({
      id: t.id as string,
      libelle: t.libelle as string,
    })),
  };

  if (organisateur) {
    const noms = await lireParLots<{ id: string; nom: string }>(
      [...traiteurIds],
      (lot) =>
        supabase
          .from('v_referentiel_traiteurs')
          .select('id, nom')
          .in('id', lot),
    );
    if (noms.error)
      return serverError(noms.error, 'dashboards.filtres.traiteurs');
    data.traiteurs = trie(new Map(noms.data.map((t) => [t.id, t.nom])));
  } else {
    data.clients = trie(clients);
  }

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
