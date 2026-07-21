/**
 * M3.5 — Dashboard Admin Bloc 2 Revenus (BL-P2-03, §11 §1.1).
 * Tableau « Revenus par organisation » à 7 colonnes (nom · type · nb ZD · CA ZD ·
 * nb AG · CA AG · Total HT), histogramme monté (RevenusHistogramme non orphelin),
 * filtre de période COMMUN au graphe ET au tableau, tri. Revue E2E Val 2026-07-18 :
 * presets (7j/30j/trimestre/12m/civile) + bouton Export CSV retirés du dashboard admin ;
 * le filtre Du/au pilote désormais l'histogramme comme le tableau ; blocs 50/50.
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
      collectes_48h_non_validees: 0,
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

// Fenêtre par défaut du bloc Revenus : 12 derniers mois glissants alignés au 1er du
// mois — identique à defaultPeriode() de la page.
function defaultWindow(): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)),
    to: iso(now),
  };
}

describe('M3.5 / Dashboard Admin Bloc 2 Revenus (BL-P2-03)', () => {
  it('M3.5/admin_revenus_7_colonnes — nom · type · nb/CA ZD · nb/CA AG · Total HT', async () => {
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
      'Total HT',
    ]) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    // Split ZD/AG rendu (type org + valeurs par type).
    expect(screen.getAllByText('Traiteur').length).toBeGreaterThan(0);
    // Colonne Total HT : montant_total (1500 = 1200 ZD + 300 AG) rendu formaté €.
    expect(screen.getAllByText(/1\s?500,00/).length).toBeGreaterThan(0);
  });

  it('M3.5/admin_kpi_cartes_cliquables — chaque carte Bloc 1 lie vers /admin/collectes?chip= (miroir §11 §1.1)', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha'); // page hydratée (KPI chargés)
    const hrefs = screen
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'));
    // Les 5 cartes-actions pointent vers le chip du MÊME prédicat que leur compteur
    // (fusion ex ZD/AG 48h → collectes_48h_non_validees, revue E2E 2026-07-15).
    for (const chip of [
      'non_transmises_zd',
      'non_transmises_ag',
      'attente_prestataire',
      'dirty_tms',
      'collectes_48h_non_validees',
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

  it('M3.5/admin_revenus_controls — titre bloc + champs de période présents, presets + export CSV retirés (revue E2E 2026-07-18)', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha');
    expect(screen.getByText('Revenu par organisation')).toBeInTheDocument();
    expect(screen.getByTestId('revenus-from')).toBeInTheDocument();
    expect(screen.getByTestId('revenus-to')).toBeInTheDocument();
    // Retirés du dashboard admin (décision Val 2026-07-18).
    expect(screen.queryByTestId('revenus-export-csv')).toBeNull();
    expect(screen.queryByText('Exporter CSV')).toBeNull();
    expect(screen.queryByText('7 jours')).toBeNull();
    expect(screen.queryByText('12 derniers mois')).toBeNull();
    expect(screen.queryByText('Année civile')).toBeNull();
  });

  it('M3.5/admin_revenus_defaut_12_mois — période par défaut = 12 derniers mois glissants (alignés au 1er du mois)', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha');
    const { from, to } = defaultWindow();
    // Les champs de date reflètent le défaut 12 mois…
    expect(screen.getByTestId('revenus-from')).toHaveValue(from);
    expect(screen.getByTestId('revenus-to')).toHaveValue(to);
    // …et le fetch de montage du tableau porte bien cette fenêtre.
    expect(
      fetchMock.mock.calls.some(([u]) => {
        const s = String(u);
        return (
          s.includes('/admin/dashboard/revenus-organisations') &&
          s.includes(`from=${from}`) &&
          s.includes(`to=${to}`)
        );
      }),
    ).toBe(true);
  });

  it('M3.5/admin_revenus_filtre_commun_graph — le filtre Du/au pilote AUSSI l’histogramme (revue E2E Val 2026-07-18)', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha');
    const { from, to } = defaultWindow();
    // Au montage, l'histogramme (kpi-admin) est requêté sur la MÊME fenêtre que le tableau.
    expect(
      fetchMock.mock.calls.some(([u]) => {
        const s = String(u);
        return (
          s.includes('/dashboards/kpi-admin') &&
          s.includes(`from=${from}`) &&
          s.includes(`to=${to}`)
        );
      }),
    ).toBe(true);
    // Modifier la borne « Du » relance le fetch de l'histogramme sur la nouvelle fenêtre.
    fetchMock.mockClear();
    fireEvent.change(screen.getByTestId('revenus-from'), {
      target: { value: '2026-01-01' },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => {
          const s = String(u);
          return (
            s.includes('/dashboards/kpi-admin') && s.includes('from=2026-01-01')
          );
        }),
      ).toBe(true),
    );
  });

  it('M3.5/admin_revenus_reinitialiser — « Réinitialiser » ramène au défaut 12 derniers mois', async () => {
    render(<DashboardAdminPage />);
    await screen.findAllByText('Traiteur Alpha');
    const { from, to } = defaultWindow();
    // On restreint d'abord à une fenêtre custom via saisie manuelle…
    fireEvent.change(screen.getByTestId('revenus-from'), {
      target: { value: '2026-05-01' },
    });
    expect(screen.getByTestId('revenus-from')).toHaveValue('2026-05-01');
    // …puis « Réinitialiser » revient au défaut 12 derniers mois glissants.
    fireEvent.click(screen.getByTestId('revenus-reinitialiser'));
    expect(screen.getByTestId('revenus-from')).toHaveValue(from);
    expect(screen.getByTestId('revenus-to')).toHaveValue(to);
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
});
