import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

const AGENCE_ROLES: ClientRole[] = ['agence'];

/**
 * GET /api/v1/agence/collectes/filtres — options des filtres de la liste
 * Collectes agence (§06.11 = §06.04 §3 « Filtres disponibles ») : Lieu et
 * Client organisateur, DÉRIVÉS des collectes que l'agence liste déjà (requête
 * sous son identité, RLS `col_select` + `evenements!inner`). Aucune lecture
 * service-role : contrairement au traiteur, l'agence n'a pas d'organisation
 * tierce à nommer — elle programme elle-même toutes ses collectes, d'où
 * `programmateurs: []` (le filtre « Programmée par » ne s'affiche qu'au-delà
 * d'une option).
 *
 * « Client organisateur » est keyé sur `evenements.nom_client_organisateur`,
 * comme la route traiteur et le filtre `client` de la liste.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;

  // Aucune borne de date (options valables pour Programmées ET Historique) ;
  // tri date décroissante pour que la troncature `max_rows` garde le plus récent.
  const { data, error } = await createSupabaseServerClient()
    .from('collectes')
    .select(
      `id,
       evenements!inner(
         nom_client_organisateur,
         lieux!lieu_id(id, nom)
       )`,
    )
    .order('date_collecte', { ascending: false });
  if (error) return serverError(error, 'agence.collectes.filtres.list');

  interface Lieu {
    id: string;
    nom: string | null;
  }
  interface Evt {
    nom_client_organisateur: string | null;
    lieux: Lieu | Lieu[] | null;
  }
  const one = <T>(v: T | T[] | null): T | null =>
    !v ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  const lieux = new Map<string, string>();
  const clients = new Set<string>();
  for (const row of (data ?? []) as unknown as { evenements: Evt | Evt[] }[]) {
    const evt = one(row.evenements);
    if (!evt) continue;
    const lieu = one(evt.lieux);
    if (lieu?.id && !lieux.has(lieu.id)) lieux.set(lieu.id, lieu.nom ?? 'Lieu');
    const nomClient = evt.nom_client_organisateur?.trim();
    if (nomClient) clients.add(nomClient);
  }

  return NextResponse.json({
    data: {
      lieux: [...lieux.entries()]
        .map(([id, nom]) => ({ id, nom }))
        .sort((a, b) => a.nom.localeCompare(b.nom)),
      clients: [...clients].sort((a, b) => a.localeCompare(b)),
      programmateurs: [],
    },
  });
}
