/**
 * Listes Admin — filtres à choix multiple, PR 2 (décision Val 2026-09-30,
 * divergence M0.8_20260930_filtres-choix-multiple-tous) : chaque filtre à
 * valeur unique devient une liste à cocher (`FiltreCoches`) avec une case
 * « Tous » en tête (= aucun filtre) ; « Période » en premier quand la barre en
 * a une. Par écran : (a) Période en premier, (b) 2 valeurs cochées → paramètre
 * CSV, (c) « Tous » efface, (d) tout cocher = aucun paramètre.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';

vi.mock('@/components/ui/impersonation-launcher', () => ({
  ImpersonationLauncher: () => null,
}));
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import ClientsPage from '@/app/(admin)/admin/clients/page';
import TransporteursPage from '@/app/(admin)/admin/transporteurs/page';
import AssociationsPage from '@/app/(admin)/admin/associations/page';
import LieuxPage from '@/app/(admin)/admin/lieux/page';
import FacturesPage from '@/app/(admin)/admin/factures/page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const ORGS = [
  { id: 'org-1', raison_sociale: 'Kaspia' },
  { id: 'org-2', raison_sociale: 'Fleur de Mets' },
];

const reponse = (data: unknown[]) =>
  ({
    ok: true,
    json: async () => ({ data, total: data.length, limit: 50 }),
  }) as Response;

const fetchParDefaut = (input: RequestInfo | URL): Promise<Response> =>
  Promise.resolve(
    reponse(
      String(input).startsWith('/api/v1/admin/organisations') ? ORGS : [],
    ),
  );
const fetchMock = vi.fn(fetchParDefaut);

/**
 * La 1re réponse de `prefixe` (lignes `perimees`) n'arrive qu'à l'appel de la
 * fonction rendue ; les suivantes répondent tout de suite (lignes `recentes`).
 */
function premiereReponseEnRetard(
  prefixe: string,
  perimees: unknown[],
  recentes: unknown[],
): () => void {
  let liberer = () => {};
  let premiere = true;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    if (!String(input).startsWith(prefixe)) return fetchParDefaut(input);
    if (!premiere) return Promise.resolve(reponse(recentes));
    premiere = false;
    return new Promise((resoudre) => {
      liberer = () => resoudre(reponse(perimees));
    });
  });
  return () => liberer();
}

/** Livre la réponse retenue et laisse la page la traiter. */
async function livrerEnRetard(liberer: () => void) {
  await act(async () => {
    liberer();
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Paramètres du dernier appel GET à `prefixe` (ex. '/api/v1/admin/lieux?'). */
function dernierAppel(prefixe: string): URLSearchParams {
  const url = fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.startsWith(prefixe))
    .at(-1);
  expect(url, `aucun appel à ${prefixe}`).toBeDefined();
  return new URL(String(url), 'http://localhost').searchParams;
}

/** Ouvre le filtre `testid` et rend sa liste à cocher (nommée par le titre). */
async function ouvrir(testid: string, titre: string) {
  fireEvent.click(screen.getByTestId(testid));
  return within(await screen.findByRole('list', { name: titre }, ATTENTE_UI));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(fetchParDefaut);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('open', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('M1.1a — liste Clients : filtres à choix multiple', () => {
  it(
    'M1.1a — Type : 2 types → types=… ; « Tous » efface ; tout cocher = aucun paramètre',
    async () => {
      render(<ClientsPage />);
      const PREFIXE = '/api/v1/admin/organisations?';
      await waitFor(() => dernierAppel(PREFIXE), ATTENTE_UI);

      const liste = await ouvrir('clients-type', 'Type');
      const tous = liste.getByRole('checkbox', { name: 'Tous' });
      expect(tous).toBeChecked();
      fireEvent.click(liste.getByRole('checkbox', { name: 'Traiteur' }));
      fireEvent.click(liste.getByRole('checkbox', { name: 'Agence' }));
      await waitFor(
        () =>
          expect(dernierAppel(PREFIXE).get('types')).toBe('traiteur,agence'),
        ATTENTE_UI,
      );
      expect(tous).not.toBeChecked();
      expect(dernierAppel(PREFIXE).get('type')).toBeNull();

      fireEvent.click(tous);
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('types')).toBeNull(),
        ATTENTE_UI,
      );

      for (const nom of [
        'Traiteur',
        'Agence',
        'Gestionnaire de lieux',
        'Client organisateur',
      ])
        fireEvent.click(liste.getByRole('checkbox', { name: nom }));
      await waitFor(() => expect(tous).toBeChecked(), ATTENTE_UI);
      expect(dernierAppel(PREFIXE).get('types')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1a — Statut : Actifs → actif=true ; Actifs + Inactifs = aucun paramètre',
    async () => {
      render(<ClientsPage />);
      const PREFIXE = '/api/v1/admin/organisations?';
      await waitFor(() => dernierAppel(PREFIXE), ATTENTE_UI);
      expect(dernierAppel(PREFIXE).get('actif')).toBeNull();

      const liste = await ouvrir('clients-statut', 'Statut');
      fireEvent.click(liste.getByRole('checkbox', { name: 'Actifs' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('actif')).toBe('true'),
        ATTENTE_UI,
      );
      fireEvent.click(liste.getByRole('checkbox', { name: 'Inactifs' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('actif')).toBeNull(),
        ATTENTE_UI,
      );
      expect(liste.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1a — une réponse plus ancienne arrivée en dernier n’écrase pas la liste Clients',
    async () => {
      const org = (id: string, raison_sociale: string) => ({
        id,
        raison_sociale,
        type: 'traiteur',
        siret: null,
        actif: true,
        nb_users: 1,
        nb_collectes_zd_12m: 0,
        nb_collectes_ag_12m: 0,
        pack_actif: null,
      });
      const liberer = premiereReponseEnRetard(
        '/api/v1/admin/organisations?',
        [org('org-old', 'Org Périmée')],
        [org('org-new', 'Org Récente')],
      );
      render(<ClientsPage />);
      const liste = await ouvrir('clients-type', 'Type');
      fireEvent.click(liste.getByRole('checkbox', { name: 'Agence' }));
      await waitFor(
        () =>
          expect(screen.getAllByText('Org Récente').length).toBeGreaterThan(0),
        ATTENTE_UI,
      );

      await livrerEnRetard(liberer);
      expect(screen.queryByText('Org Périmée')).toBeNull();
      expect(screen.getAllByText('Org Récente').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.1b — listes Transporteurs / Associations / Lieux : filtres à choix multiple', () => {
  it(
    'M1.1b — Transporteurs : Type → types_tms=… ; Statut « Actifs » pré-coché, « Tous » = aucun paramètre actif',
    async () => {
      render(<TransporteursPage />);
      const PREFIXE = '/api/v1/admin/transporteurs?';
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('actif')).toBe('true'),
        ATTENTE_UI,
      );

      const type = await ouvrir('transporteurs-type', 'Type');
      fireEvent.click(type.getByRole('checkbox', { name: 'Autre' }));
      fireEvent.click(type.getByRole('checkbox', { name: 'Par mail' }));
      await waitFor(
        () =>
          expect(dernierAppel(PREFIXE).get('types_tms')).toBe('autre,par_mail'),
        ATTENTE_UI,
      );
      expect(dernierAppel(PREFIXE).get('type_tms')).toBeNull();
      fireEvent.click(type.getByRole('checkbox', { name: 'Tous' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('types_tms')).toBeNull(),
        ATTENTE_UI,
      );

      const statut = await ouvrir('transporteurs-statut', 'Statut');
      expect(statut.getByRole('checkbox', { name: 'Actifs' })).toBeChecked();
      fireEvent.click(statut.getByRole('checkbox', { name: 'Tous' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('actif')).toBeNull(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b — Associations : « Actives » pré-cochée ; « Toutes » n’envoie AUCUN paramètre actif (plus jamais actif= vide)',
    async () => {
      render(<AssociationsPage />);
      const PREFIXE = '/api/v1/admin/associations?';
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('actif')).toBe('true'),
        ATTENTE_UI,
      );
      expect(screen.getByTestId('associations-statut')).toHaveTextContent(
        'Actives',
      );

      const statut = await ouvrir('associations-statut', 'Statut');
      fireEvent.click(statut.getByRole('checkbox', { name: 'Toutes' }));
      // Régression : l'ancien choix « Toutes » envoyait `actif=` (vide), lu
      // `false` par la route → seules les inactives s'affichaient.
      await waitFor(
        () => expect(dernierAppel(PREFIXE).has('actif')).toBe(false),
        ATTENTE_UI,
      );
      fireEvent.click(statut.getByRole('checkbox', { name: 'Inactives' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('actif')).toBe('false'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b — Lieux : Statut « Actifs » pré-coché ; Actifs + Inactifs cochés = aucun paramètre actif',
    async () => {
      render(<LieuxPage />);
      const PREFIXE = '/api/v1/admin/lieux?page';
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('actif')).toBe('true'),
        ATTENTE_UI,
      );

      const statut = await ouvrir('lieux-statut', 'Statut');
      fireEvent.click(statut.getByRole('checkbox', { name: 'Inactifs' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).has('actif')).toBe(false),
        ATTENTE_UI,
      );
      expect(statut.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M1.7 — liste Factures Admin : filtres à choix multiple', () => {
  it(
    'M1.7 — Période en premier ; Organisation / Type cochés → organisation_ids / types ; « Toutes » efface ; l’export porte les mêmes filtres',
    async () => {
      render(<FacturesPage />);
      const PREFIXE = '/api/v1/admin/factures?';
      await waitFor(() => dernierAppel(PREFIXE), ATTENTE_UI);

      // (a) Période en premier dans la barre (décision Val 2026-09-30).
      const barre = screen.getByTestId('factures-filtres');
      const periode = within(barre).getByTestId('filtre-periode');
      for (const suivant of ['filtre-organisation', 'filtre-type'])
        expect(
          periode.compareDocumentPosition(within(barre).getByTestId(suivant)) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

      // (b) Organisation : 2 cochées → organisation_ids CSV.
      const orgs = await ouvrir('filtre-organisation', 'Organisation');
      await waitFor(
        () => orgs.getByRole('checkbox', { name: 'Kaspia' }),
        ATTENTE_UI,
      );
      fireEvent.click(orgs.getByRole('checkbox', { name: 'Kaspia' }));
      await waitFor(
        () =>
          expect(dernierAppel(PREFIXE).get('organisation_ids')).toBe('org-1'),
        ATTENTE_UI,
      );
      // (d) Toutes les organisations cochées = « Toutes » = aucun paramètre.
      fireEvent.click(orgs.getByRole('checkbox', { name: 'Fleur de Mets' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('organisation_ids')).toBeNull(),
        ATTENTE_UI,
      );
      expect(orgs.getByRole('checkbox', { name: 'Toutes' })).toBeChecked();
      fireEvent.click(orgs.getByRole('checkbox', { name: 'Kaspia' }));

      const type = await ouvrir('filtre-type', 'Type');
      fireEvent.click(type.getByRole('checkbox', { name: 'Zéro Déchet' }));
      fireEvent.click(type.getByRole('checkbox', { name: 'Avoir' }));
      await waitFor(
        () =>
          expect(dernierAppel(PREFIXE).get('types')).toBe('zero_dechet,avoir'),
        ATTENTE_UI,
      );
      expect(dernierAppel(PREFIXE).get('organisation_ids')).toBe('org-1');
      expect(dernierAppel(PREFIXE).get('type')).toBeNull();
      expect(dernierAppel(PREFIXE).get('organisation_id')).toBeNull();

      // L'export CSV reprend les filtres de la liste (§12, arbitrage F3).
      fireEvent.click(screen.getByRole('button', { name: /Exporter CSV/ }));
      const exportUrl = new URL(
        String(vi.mocked(window.open).mock.calls.at(-1)?.[0]),
        'http://localhost',
      );
      expect(exportUrl.pathname).toBe('/api/v1/exports/factures');
      expect(exportUrl.searchParams.get('organisation_ids')).toBe('org-1');
      expect(exportUrl.searchParams.get('types')).toBe('zero_dechet,avoir');

      // (c) « Tous » efface le Type.
      fireEvent.click(type.getByRole('checkbox', { name: 'Tous' }));
      await waitFor(
        () => expect(dernierAppel(PREFIXE).get('types')).toBeNull(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.7 — une réponse plus ancienne arrivée en dernier n’écrase pas la liste Factures',
    async () => {
      const facture = (id: string, numero_facture: string) => ({
        id,
        numero_facture,
        type: 'zero_dechet',
        mode_facturation: 'par_collecte',
        statut: 'emise',
        pennylane_statut: null,
        montant_ht: 10,
        montant_ttc: 12,
        devise: 'EUR',
        date_emission: '2026-09-01',
        date_echeance: '2026-10-01',
        date_paiement: null,
        created_at: '2026-09-01T08:00:00Z',
        derniere_tentative_pennylane_at: null,
        pdf_url_savr: null,
        organisations: { raison_sociale: 'Kaspia' },
        entites_facturation: null,
        factures_collectes: [{ count: 1 }],
      });
      const liberer = premiereReponseEnRetard(
        '/api/v1/admin/factures?',
        [facture('f-old', 'FZD-PERIMEE')],
        [facture('f-new', 'FZD-RECENTE')],
      );
      render(<FacturesPage />);
      const type = await ouvrir('filtre-type', 'Type');
      fireEvent.click(type.getByRole('checkbox', { name: 'Avoir' }));
      await waitFor(
        () =>
          expect(screen.getAllByText('FZD-RECENTE').length).toBeGreaterThan(0),
        ATTENTE_UI,
      );

      await livrerEnRetard(liberer);
      expect(screen.queryByText('FZD-PERIMEE')).toBeNull();
      expect(screen.getAllByText('FZD-RECENTE').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );
});
