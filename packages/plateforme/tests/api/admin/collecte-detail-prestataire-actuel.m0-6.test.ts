/**
 * M0.6 — GET /api/v1/admin/collectes/[id] : prestataire actuel de la collecte.
 * §06.06 §3 Bloc 0 : « Prestataire actuel — depuis collectes.prestataire_logistique_id ».
 * §06.06 §6 : `actif = false` n'empêche que les nouvelles attributions, les
 * collectes en cours continuent.
 *
 * La route résout elle-même le prestataire (transporteur ACTIF OU DÉSACTIVÉ) : la
 * fiche le cherchait dans la liste des transporteurs actifs et affichait « non
 * attribué » sur une collecte attribuée dès que le transporteur n'y figurait plus.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type Reponse = { data: unknown; error: unknown };

// Mock à réponses PAR TABLE (et non à file d'ordre) : chaque test dit ce que
// renvoie chaque table, et relit les filtres réellement posés dessus.
const reponses = new Map<string, Reponse>();
const appels: {
  cible: string;
  select: string;
  filtres: [string, unknown][];
}[] = [];

function chaine(cible: string) {
  const appel = {
    cible,
    select: '',
    filtres: [] as [string, unknown][],
  };
  appels.push(appel);
  const fin = (): Promise<Reponse> =>
    Promise.resolve(reponses.get(cible) ?? { data: null, error: null });
  const c = {
    select: (colonnes: string) => {
      appel.select = colonnes;
      return c;
    },
    eq: (colonne: string, valeur: unknown) => {
      appel.filtres.push([colonne, valeur]);
      return c;
    },
    single: fin,
    maybeSingle: fin,
  };
  return c;
}

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => chaine(`plateforme.${table}`),
    schema: (schema: string) => ({
      from: (table: string) => chaine(`${schema}.${table}`),
    }),
  }),
}));

vi.mock('@savr/shared/src/email/index.js', () => ({ sendEmail: vi.fn() }));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function setupAuth(role: string): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: makeJwt({ user_role: role }) } },
    error: null,
  });
}

async function getDetail(): Promise<Response> {
  const { GET } = await import('@/app/api/v1/admin/collectes/[id]/route.js');
  return GET(new NextRequest('http://localhost/api/v1/admin/collectes/col-1'), {
    params: Promise.resolve({ id: 'col-1' }),
  });
}

const appelsSur = (cible: string) => appels.filter((a) => a.cible === cible);

describe('M0.6 — GET admin/collectes/[id] : prestataire actuel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reponses.clear();
    appels.length = 0;
    setupAuth('ops_savr');
  });

  it('collecte non attribuée : prestataire_actuel null, aucune lecture du référentiel', async () => {
    reponses.set('plateforme.collectes', {
      data: { id: 'col-1', prestataire_logistique_id: null },
      error: null,
    });

    const res = await getDetail();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 'col-1',
      prestataire_logistique_id: null,
      prestataire_actuel: null,
    });
    expect(appelsSur('plateforme.transporteurs')).toHaveLength(0);
    expect(appelsSur('shared.prestataires')).toHaveLength(0);
  });

  it('collecte attribuée à un transporteur désactivé depuis : il est quand même nommé (aucun filtre sur `actif`)', async () => {
    reponses.set('plateforme.collectes', {
      data: { id: 'col-1', prestataire_logistique_id: 'presta-1' },
      error: null,
    });
    // Ligne `actif = false` : la base la renvoie puisque la route ne filtre pas dessus.
    reponses.set('plateforme.transporteurs', {
      data: { id: 't-1', nom: 'Transports Dupont', type_tms: 'par_mail' },
      error: null,
    });

    const res = await getDetail();

    expect(res.status).toBe(200);
    expect((await res.json()).prestataire_actuel).toEqual({
      transporteur_id: 't-1',
      nom: 'Transports Dupont',
      type_tms: 'par_mail',
    });
    // Le pont R5 seul : filtrer sur `actif` ferait disparaître le prestataire d'une
    // collecte en cours le jour où Ops désactive son transporteur.
    const [lecture] = appelsSur('plateforme.transporteurs');
    expect(lecture!.filtres).toEqual([
      ['prestataire_logistique_id', 'presta-1'],
    ]);
    // Colonnes réelles de plateforme.transporteurs (une colonne inexistante ferait
    // échouer la requête au runtime, pas à la compilation).
    expect(lecture!.select).toBe('id, nom, type_tms');
    expect(appelsSur('shared.prestataires')).toHaveLength(0);
  });

  it('prestataire sans fiche transporteur : nommé depuis shared.prestataires, sans type de TMS', async () => {
    reponses.set('plateforme.collectes', {
      data: { id: 'col-1', prestataire_logistique_id: 'presta-2' },
      error: null,
    });
    reponses.set('plateforme.transporteurs', { data: null, error: null });
    reponses.set('shared.prestataires', {
      data: { nom: 'Veolia Province' },
      error: null,
    });

    const res = await getDetail();

    expect(res.status).toBe(200);
    expect((await res.json()).prestataire_actuel).toEqual({
      transporteur_id: null,
      nom: 'Veolia Province',
      type_tms: null,
    });
    const [lecture] = appelsSur('shared.prestataires');
    expect(lecture!.filtres).toEqual([['id', 'presta-2']]);
    expect(lecture!.select).toBe('nom');
  });

  it.each([
    ['plateforme.transporteurs', {}],
    ['shared.prestataires', { 'plateforme.transporteurs': null }],
  ] as const)(
    'lecture de %s en erreur : 500, jamais une fiche « sans prestataire »',
    async (cible, autres) => {
      reponses.set('plateforme.collectes', {
        data: { id: 'col-1', prestataire_logistique_id: 'presta-1' },
        error: null,
      });
      for (const [autre, data] of Object.entries(autres)) {
        reponses.set(autre, { data, error: null });
      }
      reponses.set(cible, {
        data: null,
        error: { code: '57014', message: 'canceling statement' },
      });

      const res = await getDetail();

      expect(res.status).toBe(500);
      // Message neutre : le détail Postgres ne sort pas.
      expect(await res.json()).toEqual({ error: 'Erreur serveur' });
    },
  );

  it('collecte introuvable : 404, aucune lecture du référentiel', async () => {
    reponses.set('plateforme.collectes', {
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });

    const res = await getDetail();

    expect(res.status).toBe(404);
    expect(appelsSur('plateforme.transporteurs')).toHaveLength(0);
  });

  it('rôle client : 403 avant toute lecture', async () => {
    setupAuth('traiteur_manager');

    const res = await getDetail();

    expect(res.status).toBe(403);
    expect(appels).toHaveLength(0);
  });
});
