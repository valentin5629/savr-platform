/**
 * M3.3 — Liste Collectes agence = liste traiteur « à l'identique » (§06.11
 * « Liste Collectes » ; §06.04 §3, refonte 2026-07-05). Revue écran E2E
 * 2026-09-30 : la page agence, copie figée d'avant la refonte, n'avait ni les
 * onglets Programmées / Historique ni les actions de ligne.
 *
 * Épingle le câblage agence du composant commun : routes `/api/v1/agence/…`
 * (jamais `/api/v1/traiteur/…`, qui refusent le rôle), partition des statuts par
 * onglet, actions Modifier / Annuler / Dupliquer pour le rôle unique `agence`.
 *
 * Requêtes bornées au <table> : DataGrid rend aussi chaque ligne en carte
 * mobile (< 640 px), qui dupliquerait chaque libellé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
  usePathname: () => '/agence/collectes',
}));

// Jeton de session de l'agence (claim métier `user_role`, lu par la liste pour
// refléter le droit d'écriture).
const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');
const JETON_AGENCE = `${b64url({ alg: 'HS256' })}.${b64url({
  sub: 'u-agence',
  user_role: 'agence',
})}.sig`;
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: JETON_AGENCE } } }),
    },
  }),
}));

import AgenceCollectesPage from '@/app/(agence)/agence/collectes/page.js';

function collecte(
  id: string,
  statut: string,
  lieu: string,
  client: string | null = null,
) {
  return {
    id,
    type: 'zero_dechet',
    statut,
    date_collecte: '2026-12-18',
    heure_collecte: '22:00:00',
    programmee_par_tiers: false,
    rapport_reserve_donneur_ordre: false,
    poids_total_kg: 0,
    taux_recyclage: null,
    co2_evite_kg: null,
    nb_repas_donnes: 0,
    evenements: {
      pax: 1443,
      nom_client_organisateur: client,
      lieux: { nom: lieu, adresse_acces: null, code_postal: null, ville: null },
    },
  };
}

const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
  const url = String(input);
  const data = url.includes('/agence/collectes/filtres')
    ? {
        lieux: [{ id: 'lieu-1', nom: 'Paris Expo Porte de Versailles' }],
        clients: [],
        programmateurs: [],
      }
    : url.includes('/annulation')
      ? { statut: 'annulee' }
      : [
          collecte(
            'c-prog',
            'programmee',
            'Paris Expo Porte de Versailles',
            'Maison Lenôtre',
          ),
          // Client saisi en espaces seuls : vaut « non renseigné ».
          collecte('c-clot', 'cloturee', 'Palais des Congrès de Paris', '   '),
        ];
  // La route de téléchargement répond { url } (URL R2 pré-signée), sans `data`.
  const corps = url.includes('/rapport-rse/download')
    ? { url: 'https://r2.example/rapport.pdf' }
    : { data };
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(corps),
  } as Response);
});

const urls = () => fetchMock.mock.calls.map(([u]) => String(u));
/** Statuts demandés par les appels de liste (hors options / actions). */
const statutsDemandes = () =>
  urls()
    .filter((u) => /\/api\/v1\/agence\/collectes\?/.test(u))
    .map((u) => new URLSearchParams(u.split('?')[1]).get('statut'));

describe('M3.3 / liste Collectes agence — parité §06.04', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    push.mockClear();
    replace.mockClear();
    searchParams = new URLSearchParams();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it(
    'M3.3/liste_agence_onglets_programmees_historique — onglets par état, Programmées par défaut, statuts partitionnés',
    async () => {
      render(<AgenceCollectesPage />);
      const programmees = screen.getByRole('tab', { name: 'Programmées' });
      expect(programmees).toHaveAttribute('aria-selected', 'true');
      await waitFor(
        () =>
          expect(statutsDemandes()).toContain(
            'brouillon,programmee,validee,en_cours',
          ),
        ATTENTE_UI,
      );

      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Historique' }));
      // L'URL (deep-link, rechargement) est réécrite sous l'espace agence.
      await waitFor(() => {
        const url = String(replace.mock.calls.at(-1)?.[0] ?? '');
        expect(url.startsWith('/agence/collectes?')).toBe(true);
        expect(url).toContain('onglet=historique');
      }, ATTENTE_UI);
      await waitFor(
        () =>
          expect(statutsDemandes()).toContain(
            'realisee,realisee_sans_collecte,cloturee,annulation_demandee,annulee,rejetee_par_prestataire',
          ),
        ATTENTE_UI,
      );
      // Sélecteur de type conservé à côté des onglets.
      expect(screen.getByRole('radio', { name: 'Zéro Déchet' })).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/liste_agence_colonne_client — le client organisateur de l’événement alimente la colonne « Client »',
    async () => {
      render(<AgenceCollectesPage />);
      const table = within(
        await screen.findByRole('table', undefined, ATTENTE_UI),
      );
      // Câblage du composant commun (traiteur + agence) : la colonne lit
      // `evenements.nom_client_organisateur`, déjà renvoyé par les deux routes.
      expect(
        await table.findByText('Maison Lenôtre', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(table.getByRole('columnheader', { name: 'Client' })).toBeTruthy();
      // Saisie faite d'espaces : cellule vide du DS, pas une cellule blanche.
      const entetes = table
        .getAllByRole('columnheader')
        .map((th) => th.textContent?.trim());
      const ligne = table
        .getByText('Palais des Congrès de Paris')
        .closest('tr');
      expect(
        within(ligne!).getAllByRole('cell')[entetes.indexOf('Client')]
          ?.textContent,
      ).toBe('—');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/liste_agence_lien_profond_historique — ?onglet=historique (drill-down Top lieux) ouvre l’Historique',
    async () => {
      searchParams = new URLSearchParams(
        'onglet=historique&lieu=lieu-1&type=zero_dechet&statut=cloturee',
      );
      render(<AgenceCollectesPage />);
      expect(screen.getByRole('tab', { name: 'Historique' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await waitFor(
        () => expect(statutsDemandes()).toContain('cloturee'),
        ATTENTE_UI,
      );
      const liste = urls().find((u) =>
        /\/api\/v1\/agence\/collectes\?/.test(u),
      );
      // Le lieu du lien part en liste d'un élément (filtres à choix multiple).
      expect(new URLSearchParams(liste!.split('?')[1]).get('lieu_ids')).toBe(
        'lieu-1',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/liste_agence_actions_ligne — Modifier / Annuler / Dupliquer, annulation sur la route agence',
    async () => {
      render(<AgenceCollectesPage />);
      const table = within(await screen.findByRole('table', {}, ATTENTE_UI));
      const ligne = within(
        (
          await table.findByText(
            'Paris Expo Porte de Versailles',
            {},
            ATTENTE_UI,
          )
        ).closest('tr') as HTMLElement,
      );
      // Le droit d'écriture dépend du rôle lu dans la session (asynchrone).
      await ligne.findByRole(
        'button',
        { name: 'Modifier la collecte' },
        ATTENTE_UI,
      );
      expect(
        ligne.getByRole('button', { name: 'Dupliquer la collecte' }),
      ).toBeTruthy();

      fireEvent.click(
        ligne.getByRole('button', { name: 'Dupliquer la collecte' }),
      );
      expect(push).toHaveBeenCalledWith('/programmer/nouveau?from=c-prog');

      fireEvent.click(
        ligne.getByRole('button', { name: 'Annuler la collecte' }),
      );
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: "Confirmer l'annulation" },
          ATTENTE_UI,
        ),
      );
      await waitFor(() => {
        const appel = fetchMock.mock.calls.find(([u]) =>
          String(u).includes('/annulation'),
        );
        expect(String(appel?.[0])).toBe(
          '/api/v1/agence/collectes/c-prog/annulation',
        );
        expect(appel?.[1]?.method).toBe('POST');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/liste_agence_routes_agence_seules — options de filtres agence, aucun appel aux routes traiteur',
    async () => {
      render(<AgenceCollectesPage />);
      await waitFor(
        () => expect(urls()).toContain('/api/v1/agence/collectes/filtres'),
        ATTENTE_UI,
      );
      await screen.findByRole('table', {}, ATTENTE_UI);
      expect(urls().some((u) => u.includes('/api/v1/traiteur/'))).toBe(false);
      // « Programmée par » n'a pas d'objet : l'agence programme tout elle-même.
      expect(screen.queryByText('Programmée par')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/liste_agence_telecharger_et_export — rapport via la route agence, export CSV aux filtres actifs',
    async () => {
      searchParams = new URLSearchParams('onglet=historique&type=zero_dechet');
      const ouvrir = vi.fn();
      vi.stubGlobal('open', ouvrir);
      render(<AgenceCollectesPage />);
      const table = within(await screen.findByRole('table', {}, ATTENTE_UI));
      const ligne = within(
        (
          await table.findByText('Palais des Congrès de Paris', {}, ATTENTE_UI)
        ).closest('tr') as HTMLElement,
      );
      fireEvent.click(
        ligne.getByRole('button', {
          name: 'Télécharger le rapport de la collecte',
        }),
      );
      await waitFor(
        () =>
          expect(ouvrir).toHaveBeenCalledWith(
            'https://r2.example/rapport.pdf',
            '_blank',
          ),
        ATTENTE_UI,
      );
      expect(urls()).toContain(
        '/api/v1/agence/collectes/c-clot/rapport-rse/download',
      );

      fireEvent.click(screen.getByRole('button', { name: 'Exporter CSV' }));
      const exportUrl = String(ouvrir.mock.calls.at(-1)?.[0] ?? '');
      expect(exportUrl.startsWith('/api/v1/exports/collectes?')).toBe(true);
      // Mêmes paramètres que la liste affichée : type + statuts de l'onglet.
      const qs = new URLSearchParams(exportUrl.split('?')[1]);
      expect(qs.get('type')).toBe('zero_dechet');
      expect(qs.get('statut')).toBe(
        'realisee,realisee_sans_collecte,cloturee,annulation_demandee,annulee,rejetee_par_prestataire',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/liste_agence_ancien_lien_sans_onglet — ?lieu=…&statut=cloturee sans onglet ouvre l’Historique',
    async () => {
      searchParams = new URLSearchParams(
        'lieu=lieu-1&type=zero_dechet&statut=cloturee',
      );
      render(<AgenceCollectesPage />);
      expect(screen.getByRole('tab', { name: 'Historique' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await waitFor(
        () => expect(statutsDemandes()).toContain('cloturee'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/liste_agence_statut_hors_onglet_jamais_vide — un statut hors onglet retombe sur les statuts de l’onglet',
    async () => {
      searchParams = new URLSearchParams('onglet=programmees&statut=cloturee');
      render(<AgenceCollectesPage />);
      await waitFor(
        () => expect(statutsDemandes().length).toBeGreaterThan(0),
        ATTENTE_UI,
      );
      // Jamais `statut=` vide : les routes ne filtreraient plus aucun statut.
      expect(statutsDemandes()).not.toContain('');
      expect(statutsDemandes()).toContain(
        'brouillon,programmee,validee,en_cours',
      );
    },
    ATTENTE_CAS_MS,
  );
});
