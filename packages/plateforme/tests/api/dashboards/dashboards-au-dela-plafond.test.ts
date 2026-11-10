/**
 * M3.5 / M3.6 — Dashboards au-delà du plafond de lignes de l'API de données.
 *
 * Une réponse est amputée à 1 000 lignes sans erreur (mesure :
 * `src/lib/pdf/selection-par-pages.ts`). Les chargeurs de dashboards lisaient
 * les collectes clôturées en une requête : passé ce volume (historique Bubble),
 * KPI, évolution, classements et synthèse PDF étaient calculés sur une partie
 * des collectes, sans message. Chaque cas ci-dessous échoue sur une lecture
 * unique.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  creerApiPlafonnee,
  PLAFOND_LIGNES,
  type Ligne,
} from '@/test-utils/api-donnees-plafonnee';
import { TAILLE_PAGE } from '@/lib/pdf/selection-par-pages.js';

// Lectures service_role annexes (facteurs et méthode CO₂) : tables vides, les
// chargeurs retombent sur leurs constantes.
let service = creerApiPlafonnee();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => service.client,
}));

import { loadAdminDashboardClient } from '@/lib/dashboards/admin-dashboard-client.js';
import {
  loadBlocs,
  loadEvolution,
  loadFiltresParcGestionnaire,
  loadMargeAttente,
  type DbClient,
  type LoaderCtx,
} from '@/lib/dashboards/loaders.js';
import { buildSyntheseSnapshot } from '@/lib/dashboards/synthese-snapshot.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const TRAITEUR = '0b000000-0000-4000-8000-000000000001';
const LIEU = '0c000000-0000-4000-8000-000000000001';

const id = (prefixe: string, i: number) =>
  `${prefixe}-${String(i).padStart(5, '0')}`;
const suite = <T>(n: number, ligne: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => ligne(i));

/** Collecte clôturée telle que les chargeurs la lisent, embeds compris. */
function collecte(i: number, type: 'zero_dechet' | 'anti_gaspi'): Ligne {
  return {
    id: id('col', i),
    type,
    statut: 'cloturee',
    date_collecte: '2026-03-10',
    realisee_at: '2026-03-10T22:00:00Z',
    pax: 100,
    taux_recyclage: type === 'zero_dechet' ? 80 : null,
    co2_evite_kg: 2,
    co2_induit_kg: 1,
    co2_net_kg: -1,
    energie_primaire_evitee_kwh: 0,
    co2_facteurs_snapshot: null,
    evenements: {
      id: id('evt', i),
      nom_evenement: `Événement ${i}`,
      date_evenement: '2026-03-10',
      lieu_id: LIEU,
      pax: 100,
      organisation_id: ORG,
      client_organisateur_organisation_id: null,
      type_evenement_id: null,
      traiteur_operationnel_organisation_id: TRAITEUR,
      created_by: 'user-1',
      lieux: { id: LIEU, nom: 'Pavillon' },
    },
    collecte_flux:
      type === 'zero_dechet'
        ? [{ poids_reel_kg: 10, flux_dechets: { code: 'biodechets' } }]
        : [],
    attributions_antgaspi:
      type === 'anti_gaspi'
        ? {
            volume_repas_realise: 3,
            association_id: 'asso-1',
            associations: { id: 'asso-1', nom: 'Les Restos', ville: 'Paris' },
          }
        : null,
    factures_collectes: [],
  };
}

const traiteur: LoaderCtx = {
  userId: 'user-1',
  role: 'traiteur_manager',
  organisationId: ORG,
};

/** Chaque lecture de collectes est une page triée par id et bornée. */
function attendrePages(
  api: ReturnType<typeof creerApiPlafonnee>,
  total: number,
) {
  const pages = api.lecturesDe('collectes');
  expect(pages.every((p) => p.tris.at(-1) === 'id')).toBe(true);
  expect(pages.every((p) => p.limite === TAILLE_PAGE)).toBe(true);
  expect(pages.reduce((s, p) => s + p.rendues, 0)).toBe(total);
}

/**
 * Met `table` en panne à partir de sa n-ième lecture : les lectures d'avant
 * sont servies. Une page en échec au milieu d'une lecture par pages ne doit pas
 * laisser un résultat calculé sur les pages déjà lues.
 */
function panneALaLecture(
  api: ReturnType<typeof creerApiPlafonnee>,
  table: string,
  rang: number,
): void {
  const client = api.client as { from: (t: string) => unknown };
  api.client = {
    ...client,
    from: (t: string) => {
      if (t === table && api.lecturesDe(table).length + 1 >= rang)
        api.pannes[table] = { message: 'panne', code: 'XX000' };
      return client.from(t);
    },
  };
}

beforeEach(() => {
  service = creerApiPlafonnee();
});

describe('M3.6 / Dashboard Client Admin au-delà du plafond', () => {
  const parametres = {
    type: 'anti_gaspi' as const,
    from: null,
    to: null,
    organisationIds: [],
    lieuIds: [],
    traiteurIds: [],
    typeEvtIds: [],
    tailleEvts: [],
  };

  it('1 500 collectes AG clôturées, toutes organisations : KPI, évolution et classements sur les 1 500', async () => {
    // ~1 500 collectes anti-gaspi clôturées : le volume attendu après l'import.
    const api = creerApiPlafonnee({
      collectes: suite(1500, (i) => collecte(i, 'anti_gaspi')),
      organisations: [{ id: TRAITEUR, nom: 'Maison Test' }],
    });

    const payload = await loadAdminDashboardClient(
      api.client as Parameters<typeof loadAdminDashboardClient>[0],
      parametres,
    );

    expect(payload.kpi).toMatchObject({
      nb_collectes: 1500,
      nb_repas_donnes: 4500,
    });
    expect(payload.co2.eviteKg).toBe(3000);
    expect(
      payload.evolution.series.reduce(
        (s, b) => s + (b.nb_collectes as number),
        0,
      ),
    ).toBe(1500);
    expect(payload.blocs.topLieux[0]!.nb_collectes).toBe(1500);
    expect(payload.blocs.topActeurs[0]).toMatchObject({
      nb_collectes: 1500,
      label: 'Maison Test',
    });
    expect(payload.blocs.topAssociations![0]!.nb_collectes).toBe(1500);
    attendrePages(api, 1500);
  });

  it('la deuxième page en échec fait échouer le chargement, sans KPI calculés sur la première', async () => {
    const api = creerApiPlafonnee({
      collectes: suite(TAILLE_PAGE + 50, (i) => collecte(i, 'anti_gaspi')),
    });
    panneALaLecture(api, 'collectes', 2);

    await expect(
      loadAdminDashboardClient(
        api.client as Parameters<typeof loadAdminDashboardClient>[0],
        parametres,
      ),
    ).rejects.toThrow('Erreur serveur');
    // La première page a été servie, la panne tombe sur la deuxième.
    expect(api.lecturesDe('collectes').map((l) => l.rendues)).toEqual([
      TAILLE_PAGE,
      0,
    ]);
  });
});

describe('M3.5 / dashboards clients au-delà du plafond', () => {
  it('évolution : 1 300 collectes ZD comptées dans la série', async () => {
    const api = creerApiPlafonnee({
      collectes: suite(1300, (i) => collecte(i, 'zero_dechet')),
    });

    const { series } = await loadEvolution(api.client as DbClient, traiteur, {
      type: 'zero_dechet',
      from: '2026-01-01',
      to: '2026-12-31',
    });

    expect(series.reduce((s, b) => s + (b.nb_collectes as number), 0)).toBe(
      1300,
    );
    expect(series.reduce((s, b) => s + (b.tonnage_total as number), 0)).toBe(
      13000,
    );
    attendrePages(api, 1300);
  });

  it('Top listes : 1 300 collectes ZD dans le classement des lieux et des commerciaux', async () => {
    const api = creerApiPlafonnee({
      collectes: suite(1300, (i) => collecte(i, 'zero_dechet')),
      users: [{ id: 'user-1', prenom: 'Ada', nom: 'Martin' }],
    });

    const blocs = await loadBlocs(api.client as DbClient, traiteur, {
      type: 'zero_dechet',
      from: null,
      to: null,
    });

    expect(blocs.topLieux[0]).toMatchObject({
      nb_collectes: 1300,
      tonnage_kg: 13000,
    });
    expect(blocs.topActeurs![0]).toMatchObject({
      nb_collectes: 1300,
      label: 'Ada Martin',
    });
    attendrePages(api, 1300);
  });

  it('badge « en attente de facturation » : 1 200 collectes ZD sans facture toutes comptées', async () => {
    const api = creerApiPlafonnee({
      collectes: suite(1200, (i) => collecte(i, 'zero_dechet')),
    });

    const { nb_en_attente } = await loadMargeAttente(api.client as DbClient, {
      from: null,
      to: null,
    });

    expect(nb_en_attente).toBe(1200);
    attendrePages(api, 1200);
  });

  it('filtres du gestionnaire : un traiteur intervenu seulement sur des collectes lues après la 1 000ᵉ est listé', async () => {
    const traiteurDe = (i: number) =>
      i < PLAFOND_LIGNES
        ? { id: TRAITEUR, nom: 'Maison Test' }
        : { id: 'org-tardif', nom: 'Traiteur Tardif' };
    const api = creerApiPlafonnee({
      organisations_lieux: [{ lieu_id: LIEU }],
      v_lieux_clients: [{ id: LIEU, nom: 'Pavillon' }],
      collectes: suite(PLAFOND_LIGNES + 250, (i) => ({
        id: id('col', i),
        date_collecte: '2099-01-01',
        evenements: {
          lieu_id: LIEU,
          traiteur_operationnel_organisation_id: traiteurDe(i).id,
          organisations: traiteurDe(i),
        },
      })),
    });

    const filtres = await loadFiltresParcGestionnaire(api.client as DbClient);

    expect(filtres.traiteurs).toEqual([
      { id: TRAITEUR, nom: 'Maison Test' },
      { id: 'org-tardif', nom: 'Traiteur Tardif' },
    ]);
    attendrePages(api, PLAFOND_LIGNES + 250);
  });

  /** Synthèse d'un traiteur sur 2026, sans filtre. */
  const synthese = (api: ReturnType<typeof creerApiPlafonnee>) =>
    buildSyntheseSnapshot(
      api.client as Parameters<typeof buildSyntheseSnapshot>[0],
      {
        role: 'traiteur_manager',
        organisationId: ORG,
        organisationNom: 'Maison Test',
      },
      {
        from: '2026-01-01',
        to: '2026-12-31',
        types: [],
        lieuIds: [],
        traiteurIds: [],
        clientOrgaIds: [],
        clientNoms: [],
        commercialIds: [],
        typeEvtIds: [],
        tailleEvts: [],
      },
      {
        nowIso: '2026-06-01T10:00:00Z',
        cutoffIso: '2026-05-31T10:00:00Z',
        dateGenerationLabel: '01/06/2026',
      },
    );

  it('synthèse PDF : 1 400 collectes (ZD et AG) dans les totaux du rapport', async () => {
    const api = creerApiPlafonnee({
      collectes: suite(1400, (i) =>
        collecte(i, i < 900 ? 'anti_gaspi' : 'zero_dechet'),
      ),
    });

    const snapshot = await synthese(api);

    expect(snapshot.nb_collectes).toBe(1400);
    expect(snapshot.nb_repas_donnes).toBe(900 * 3);
    expect(snapshot.tonnage_zd_kg).toBe(500 * 10);
    attendrePages(api, 1400);
  });

  it('synthèse PDF : la deuxième page en échec fait échouer le rapport, sans totaux calculés sur la première', async () => {
    const api = creerApiPlafonnee({
      collectes: suite(TAILLE_PAGE + 50, (i) => collecte(i, 'zero_dechet')),
    });
    panneALaLecture(api, 'collectes', 2);

    await expect(synthese(api)).rejects.toThrow('Erreur serveur');
    expect(api.lecturesDe('collectes').map((l) => l.rendues)).toEqual([
      TAILLE_PAGE,
      0,
    ]);
  });
});
