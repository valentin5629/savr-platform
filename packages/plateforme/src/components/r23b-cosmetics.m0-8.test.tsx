/**
 * R23b — Tests des cosmétiques espaces clients (BL-P3-02..08).
 * Titrés « M0.8-XX » → exécutés par `pnpm test:module M0.8` (filtre par titre).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// KpiCard consomme useRouter (next/navigation) — pas de router en jsdom.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

import { refCourteCollecte } from '@/lib/collecte-ref';
import { margeTooltipZd } from '@/lib/marge-tooltip';
import { PreferencesLangueCard } from '@/components/compte/preferences-langue';
import { DashboardFilterBar } from '@/components/dashboards/DashboardFilterBar';
import { periodeDerniers } from '@/lib/periodes-raccourcis';

// ── BL-P3-03 — référence courte (jamais l'UUID brut) ────────────────────────
describe('M0.8-43 — refCourteCollecte préfère tms_reference sinon UUID court (BL-P3-03)', () => {
  it('rend la référence TMS quand elle existe', () => {
    expect(
      refCourteCollecte({
        tms_reference: 'CMD-2026-001',
        id: 'abcdef01-2345-6789-abcd-ef0123456789',
      }),
    ).toBe('CMD-2026-001');
  });
  it('abrège l’UUID (8 hex majuscules) sans référence TMS', () => {
    expect(
      refCourteCollecte({
        tms_reference: null,
        id: 'abcdef01-2345-6789-abcd-ef0123456789',
      }),
    ).toBe('ABCDEF01');
  });
});

// ── BL-P3-08 — bloc Préférences (langue FR figé) ────────────────────────────
describe('M0.8-44 — PreferencesLangueCard affiche la langue française figée (BL-P3-08)', () => {
  it('rend « Français (FR) » en lecture seule', () => {
    render(<PreferencesLangueCard />);
    expect(screen.getByTestId('preferences-langue')).toBeInTheDocument();
    expect(screen.getByText(/Français \(FR\)/)).toBeInTheDocument();
  });
});

// ── BL-P3-02 — presets période + Réinitialiser généralisé ───────────────────
describe('M0.8-45 — DashboardFilterBar expose presets + Réinitialiser hors mode parc (BL-P3-02)', () => {
  it('rend les 5 presets CDC et le bouton Réinitialiser sans parcOptions', () => {
    const onChange = vi.fn();
    render(
      <DashboardFilterBar storageKey="test-r23b-presets" onChange={onChange} />,
    );
    // Liste CDC exacte §06.04 l.73 / §06.05 l.105 (Personnalisé = le calendrier),
    // en colonne dans le panneau du filtre Période (décision Val 2026-09-30).
    fireEvent.click(screen.getByTestId('dashboard-filter-periode'));
    for (const key of ['7j', '30j', 'trimestre', '12m', 'civile']) {
      expect(
        screen.getByTestId(`dashboard-filter-preset-${key}`),
      ).toBeInTheDocument();
    }
    // Réinitialiser était gestionnaire-only (garde parcOptions) → désormais
    // disponible partout, mais seulement quand un filtre diffère du défaut
    // (R-UI-4b, D5 : `FilterBar actif`) — ici tout est au défaut.
    expect(screen.queryByTestId('dashboard-filter-reinitialiser')).toBeNull();
  });

  it('applique un preset : onChange rappelé après clic', () => {
    const onChange = vi.fn();
    render(
      <DashboardFilterBar storageKey="test-r23b-apply" onChange={onChange} />,
    );
    const before = onChange.mock.calls.length; // ≥1 (appel au montage)
    fireEvent.click(screen.getByTestId('dashboard-filter-periode'));
    fireEvent.click(screen.getByTestId('dashboard-filter-preset-7j'));
    // Le raccourci pose un brouillon : rien n'est émis avant « Appliquer ».
    expect(onChange.mock.calls.length).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(onChange.mock.calls.length).toBeGreaterThan(before);
    const last = onChange.mock.calls.at(-1)?.[0] as {
      from: string;
      to: string;
    };
    // Fenêtre exacte du raccourci « 7 derniers jours » (liste standard).
    expect(last).toMatchObject(periodeDerniers(7, 'jours')!);
    // La période diffère du défaut → « Réinitialiser les filtres » apparaît.
    expect(
      screen.getByTestId('dashboard-filter-reinitialiser'),
    ).toBeInTheDocument();
  });

  it('M0.8-56 — période par défaut = 12 derniers mois (§11 aligné §06.04/05)', () => {
    const onChange = vi.fn();
    render(
      <DashboardFilterBar
        storageKey="test-r23b-default12mois"
        onChange={onChange}
      />,
    );
    // Au montage (localStorage vide), onChange reçoit le défaut.
    const first = onChange.mock.calls[0]?.[0] as { from: string; to: string };
    const from = new Date(first.from);
    const to = new Date(first.to);
    const monthsDiff =
      (to.getFullYear() - from.getFullYear()) * 12 +
      (to.getMonth() - from.getMonth());
    expect(monthsDiff).toBe(12);
  });
});

// ── BL-P3-02 — tooltip KPI Marge : formule avec valeurs réelles (scénario P1) ──
describe('M0.8-48 — margeTooltipZd restitue tarif × pax − coût = marge (BL-P3-02)', () => {
  it('reproduit le scénario P1 kpi_marge_zd_formule_nominale (1,50 × 1200 − 1032 = 768)', () => {
    // Coût dérivé : tarif×pax − marge = 1,50×1200 − 768 = 1032.
    expect(margeTooltipZd(1.5, 1200, 768)).toBe(
      'Marge = 1,50 €/pax × 1200 pax − 1032,00 € = 768,00 €',
    );
  });
  it('gère une marge négative', () => {
    expect(margeTooltipZd(1.5, 100, -50)).toBe(
      'Marge = 1,50 €/pax × 100 pax − 200,00 € = -50,00 €',
    );
  });
});

// Note R24c : les ex-scénarios M0.8-46 (KpiCard tooltip) et M0.8-47
// (BenchmarkLegend) ont été retirés — leurs composants `KpiCard` et
// `BenchmarkLegend` sont supprimés (déclinaison Cockpit des dashboards clients,
// remplacés par `StatCard` + la légende intégrée de `BenchmarkRadar`).
