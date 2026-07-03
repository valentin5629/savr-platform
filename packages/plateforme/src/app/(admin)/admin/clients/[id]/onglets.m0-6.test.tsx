/**
 * M0.6 — Fiche organisation : onglets câblés (BL-P1-BOA-08, §06.06 §8).
 * Vérifie que les onglets rendent leurs données (collectes, factures, grille ZD,
 * tarif refacturé, coefficient perte labo) et que le gating read-only ops
 * (bandeau « Lecture seule » + actions désactivées) suit le droit `canEdit`
 * (dérivé du claim `user_role` côté page).
 *
 * NB : DataTable rend desktop (table) + mobile (cards) → libellés en double,
 * assertions en getAllBy*.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), refresh: vi.fn() }),
}));

import {
  OngletCollectes,
  OngletFactures,
  OngletGrilleZd,
  OngletTarifRefacture,
  OngletCoefficients,
} from './onglets';

// ── Fixtures ────────────────────────────────────────────────────────────────

const collecte = {
  id: 'col-1',
  type: 'zero_dechet',
  statut: 'cloturee',
  date_collecte: '2026-05-02',
  evenements: {
    nom_evenement: 'Gala ZD',
    pax: 120,
    lieux: { nom: 'Salle Wagram', ville: 'Paris' },
  },
};

const facture = {
  id: 'fac-1',
  numero_facture: 'ZD-2026-0005',
  type: null,
  statut: 'payee',
  montant_ttc: 5760,
  date_emission: '2025-06-28',
};

const grille = {
  id: 'g1',
  nom: 'Grille standard V1',
  description: null,
  est_defaut: true,
  tarifs_zero_dechet: [
    {
      id: 't1',
      pax_min: 1,
      pax_max: 250,
      prix_base_ht: 450,
      prix_par_couvert_ht: 0,
    },
  ],
};

const coefficient = {
  id: 'c1',
  annee_reference: 2025,
  coefficient_kg_couvert: 0.18,
  source_commentaire: 'Estimation labo',
  saisi_par: 'u-ops',
  saisi_le: '2026-06-19T16:33:22Z',
  saisi_par_user: { prenom: 'Ops', nom: 'Un' },
};

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
let calls: FetchCall[] = [];

function mockFetch(routes: Record<string, unknown>) {
  global.fetch = vi.fn(
    (url: string, init?: { method?: string; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const payload = key ? routes[key] : { data: [] };
      return Promise.resolve({
        ok: true,
        json: async () => payload,
      }) as unknown as Promise<Response>;
    },
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  mockPush.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── Collectes ───────────────────────────────────────────────────────────────

describe('M0.6 — onglet Collectes', () => {
  it('rend la liste des collectes de l’organisation', async () => {
    mockFetch({ '/api/v1/admin/collectes': { data: [collecte] } });
    render(<OngletCollectes organisationId="org-1" />);
    await waitFor(() =>
      expect(screen.getAllByText('Gala ZD').length).toBeGreaterThan(0),
    );
    // Filtre serveur par organisation appliqué.
    expect(
      calls.some((c) =>
        c.url.includes('/api/v1/admin/collectes?organisation_id=org-1'),
      ),
    ).toBe(true);
    expect(screen.getAllByText(/Salle Wagram/).length).toBeGreaterThan(0);
  });

  it('clic sur une ligne → navigue vers la fiche collecte', async () => {
    mockFetch({ '/api/v1/admin/collectes': { data: [collecte] } });
    render(<OngletCollectes organisationId="org-1" />);
    await waitFor(() =>
      expect(screen.getAllByText('Gala ZD').length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByText('Gala ZD')[0] as HTMLElement);
    expect(mockPush).toHaveBeenCalledWith('/admin/collectes/col-1');
  });
});

// ── Factures ────────────────────────────────────────────────────────────────

describe('M0.6 — onglet Factures', () => {
  it('rend la liste des factures de l’organisation', async () => {
    mockFetch({ '/api/v1/admin/factures': { data: [facture] } });
    render(<OngletFactures organisationId="org-1" />);
    await waitFor(() =>
      expect(screen.getAllByText('ZD-2026-0005').length).toBeGreaterThan(0),
    );
    expect(
      calls.some((c) =>
        c.url.includes('/api/v1/admin/factures?organisation_id=org-1'),
      ),
    ).toBe(true);
    expect(screen.getAllByText('Payée').length).toBeGreaterThan(0);
  });
});

// ── Grille ZD ───────────────────────────────────────────────────────────────

describe('M0.6 — onglet Grille tarifaire ZD', () => {
  it('admin : sélecteur de grille + paliers, pas de bandeau read-only', async () => {
    mockFetch({ '/api/v1/admin/grilles-tarifaires-zd': { data: [grille] } });
    render(
      <OngletGrilleZd
        organisationId="org-1"
        grilleId={null}
        canEdit={true}
        onUpdated={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Grille tarifaire ZD')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Lecture seule/)).not.toBeInTheDocument();
    expect(screen.getByText(/450/)).toBeInTheDocument();
  });

  it('ops : bandeau read-only + pas de sélecteur', async () => {
    mockFetch({ '/api/v1/admin/grilles-tarifaires-zd': { data: [grille] } });
    render(
      <OngletGrilleZd
        organisationId="org-1"
        grilleId={null}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/Lecture seule/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByLabelText('Grille tarifaire ZD'),
    ).not.toBeInTheDocument();
  });
});

// ── Tarif refacturé ─────────────────────────────────────────────────────────

describe('M0.6 — onglet Tarif refacturé', () => {
  it('admin : bouton Modifier → PATCH tarif_refacture_pax_zd', async () => {
    mockFetch({ '/api/v1/admin/organisations/org-1': { id: 'org-1' } });
    const onUpdated = vi.fn();
    render(
      <OngletTarifRefacture
        organisationId="org-1"
        value={1.5}
        canEdit={true}
        onUpdated={onUpdated}
      />,
    );
    expect(screen.queryByText(/Lecture seule/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Modifier'));
    const input = screen.getByLabelText('Tarif refacturé (€/pax)');
    fireEvent.change(input, { target: { value: '2.25' } });
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toMatchObject({ tarif_refacture_pax_zd: 2.25 });
  });

  it('ops : bandeau read-only + pas de bouton Modifier', () => {
    mockFetch({});
    render(
      <OngletTarifRefacture
        organisationId="org-1"
        value={1.5}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByText(/Lecture seule/)).toBeInTheDocument();
    expect(screen.queryByText('Modifier')).not.toBeInTheDocument();
  });
});

// ── Coefficient perte labo ──────────────────────────────────────────────────

describe('M0.6 — onglet Coefficient de perte labo', () => {
  it('rend les coefficients + année d’application = année réf + 1', async () => {
    mockFetch({
      '/api/v1/admin/coefficients-perte-labo': { data: [coefficient] },
    });
    render(<OngletCoefficients organisationId="org-1" canEdit={true} />);
    await waitFor(() => expect(screen.getByText('2025')).toBeInTheDocument());
    // « Appliqué aux événements de » = 2026 (année réf + 1).
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.getByText('Estimation labo')).toBeInTheDocument();
    // Colonne « Saisi par » = auteur résolu (§06.06 §8 tableau coefficients).
    expect(screen.getByText('Ops Un')).toBeInTheDocument();
  });

  it('admin : Ajouter → POST coefficient', async () => {
    mockFetch({
      '/api/v1/admin/coefficients-perte-labo': { data: [] },
    });
    render(<OngletCoefficients organisationId="org-1" canEdit={true} />);
    await waitFor(() =>
      expect(
        screen.getByText('Aucun coefficient communiqué'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Ajouter un coefficient'));
    fireEvent.change(
      screen.getByLabelText('Coefficient (kg/couvert)', {
        selector: 'input',
      }),
      {
        target: { value: '0.17' },
      },
    );
    fireEvent.click(screen.getByText('Enregistrer'));
    await waitFor(() => {
      const post = calls.find(
        (c) =>
          c.method === 'POST' &&
          c.url === '/api/v1/admin/coefficients-perte-labo',
      );
      expect(post?.body).toMatchObject({
        organisation_id: 'org-1',
        coefficient_kg_couvert: 0.17,
      });
    });
  });

  it('ops : bandeau read-only + pas de bouton Ajouter', async () => {
    mockFetch({
      '/api/v1/admin/coefficients-perte-labo': { data: [coefficient] },
    });
    render(<OngletCoefficients organisationId="org-1" canEdit={false} />);
    await waitFor(() =>
      expect(screen.getByText(/Lecture seule/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText('Ajouter un coefficient'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Éditer')).not.toBeInTheDocument();
  });
});
