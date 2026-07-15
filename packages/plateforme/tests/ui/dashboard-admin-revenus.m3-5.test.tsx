/**
 * M3.5 — Dashboard Admin Bloc 2 Revenus (BL-P2-03, §11 §1.1).
 * Tableau « Revenus par organisation » à 6 colonnes (nom · type · nb ZD · CA ZD ·
 * nb AG · CA AG), histogramme 12 mois monté (RevenusHistogramme n'est plus
 * orphelin), sélecteur de période, tri, export CSV.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';

import DashboardAdminPage from '@/app/(admin)/admin/dashboard/page.js';

function jsonResponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(obj),
    blob: () => Promise.resolve(new Blob(['x'], { type: 'text/csv' })),
  } as unknown as Response);
}

const revenusRows = [
  {
    organisation_id: 'o1',
    raison_sociale: 'Traiteur Alpha',
    type_organisation: 'traiteur',
    type_label: 'Traiteur',
    nb_zd: 5,
    montant_zd_ht: 1200,
    nb_ag: 2,
    montant_ag_ht: 300,
    montant_total: 1500,
  },
  {
    organisation_id: 'o2',
    raison_sociale: 'Agence Beta',
    type_organisation: 'agence',
    type_label: 'Agence',
    nb_zd: 1,
    montant_zd_ht: 200,
    nb_ag: 0,
    montant_ag_ht: 0,
    montant_total: 200,
  },
];

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/admin/dashboard/kpi'))
    return jsonResponse({
      non_transmises_zd: 0,
      non_transmises_ag: 0,
      attente_prestataire: 0,
      dirty_tms: 0,
      zd_48h: 0,
      ag_48h: 0,
    });
  if (url.includes('/admin/dashboard/revenus-organisations'))
    return jsonResponse({ data: revenusRows, total: 2, page: 1, limit: 50 });
  if (url.includes('/dashboards/kpi-admin'))
    return jsonResponse({
      kpi: [
        {
          mois: '2026-06-01',
          type_collecte: 'zero_dechet',
          nb_collectes: 5,
          nb_cloturees: 5,
          montant_factures_ht: 1200,
        },
      ],
    });
  return jsonResponse({});
});

beforeEach(() => {
  cleanup();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('M3.5 / Dashboard Admin Bloc 2 Revenus (BL-P2-03)', () => {
  it('M3.5/admin_revenus_6_colonnes — nom · type · nb/CA ZD · nb/CA AG', async () => {
    render(<DashboardAdminPage />);
    expect(
      (await screen.findAllByText('Traiteur Alpha')).length,
    ).toBeGreaterThan(0);
    for (const header of [
      'Organisation',
      'Type',
      'Nb ZD',
      'CA ZD HT',
      'Nb AG',
      'CA AG HT',
    ]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    // Split ZD/AG rendu (type org + valeurs par type).
    expect(screen.getAllByText('Traiteur').length).toBeGreaterThan(0);
  });

  it('M3.5/admin_kpi_cartes_cliquables — chaque carte Bloc 1 lie vers /admin/collectes?chip= (miroir §11 §1.1)', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha'); // page hydratée (KPI chargés)
    const hrefs = screen
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'));
    // Les 6 cartes-actions pointent vers le chip du MÊME prédicat que leur compteur.
    for (const chip of [
      'non_transmises_zd',
      'non_transmises_ag',
      'attente_prestataire',
      'dirty_tms',
      'zd_48h',
      'ag_48h',
    ]) {
      expect(hrefs).toContain(`/admin/collectes?chip=${chip}`);
    }
  });

  it('M3.5/admin_revenus_histogramme_monte — RevenusHistogramme n’est plus orphelin', async () => {
    render(<DashboardAdminPage />);
    expect(
      await screen.findByTestId('revenus-histogramme'),
    ).toBeInTheDocument();
  });

  it('M3.5/admin_revenus_controls — période + export CSV présents', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha');
    expect(screen.getByTestId('revenus-from')).toBeInTheDocument();
    expect(screen.getByTestId('revenus-to')).toBeInTheDocument();
    expect(screen.getByTestId('revenus-export-csv')).toBeInTheDocument();
  });

  it('M3.5/admin_revenus_tri — clic sur une colonne triable relance le fetch trié', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha');
    fetchMock.mockClear();
    // 1re occurrence = en-tête desktop <th> porteur du onClick de tri.
    fireEvent.click(screen.getAllByText('CA AG HT')[0]!);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) =>
          String(u).includes('sort=montant_ag_ht'),
        ),
      ).toBe(true),
    );
  });

  it('M3.5/admin_revenus_export_csv — le bouton déclenche un fetch format=csv', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha');
    // jsdom : stub des API de téléchargement.
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL);
    fetchMock.mockClear();
    fireEvent.click(screen.getByTestId('revenus-export-csv'));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('format=csv')),
      ).toBe(true),
    );
  });
});
