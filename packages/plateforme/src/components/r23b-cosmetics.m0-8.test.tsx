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
import { KpiCard } from '@/components/dashboards/KpiCard';
import { BenchmarkLegend } from '@/components/dashboards/BenchmarkLegend';
import { DashboardFilterBar } from '@/components/dashboards/DashboardFilterBar';

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
    // Liste CDC exacte §06.04 l.73 / §06.05 l.105 (Personnalisé = les champs date).
    for (const key of ['7j', '30j', 'trimestre', '12m', 'civile']) {
      expect(
        screen.getByTestId(`dashboard-filter-preset-${key}`),
      ).toBeInTheDocument();
    }
    // Réinitialiser était gestionnaire-only (garde parcOptions) → désormais présent partout.
    expect(
      screen.getByTestId('dashboard-filter-reinitialiser'),
    ).toBeInTheDocument();
  });

  it('applique un preset : onChange rappelé après clic', () => {
    const onChange = vi.fn();
    render(
      <DashboardFilterBar storageKey="test-r23b-apply" onChange={onChange} />,
    );
    const before = onChange.mock.calls.length; // ≥1 (appel au montage)
    fireEvent.click(screen.getByTestId('dashboard-filter-preset-7j'));
    expect(onChange.mock.calls.length).toBeGreaterThan(before);
    const last = onChange.mock.calls.at(-1)?.[0] as {
      from: string;
      to: string;
    };
    expect(last.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(last.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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

// ── BL-P3-02 — tooltip KPI (marqueur info) ──────────────────────────────────
describe('M0.8-46 — KpiCard rend un marqueur info quand tooltip est fourni (BL-P3-02)', () => {
  it('affiche le marqueur « ? » avec aria-label = tooltip', () => {
    render(
      <KpiCard label="Marge générée" value="1 200 €" tooltip="Formule marge" />,
    );
    const marker = screen.getByRole('note');
    expect(marker).toHaveAttribute('aria-label', 'Formule marge');
  });
  it('n’affiche aucun marqueur sans tooltip', () => {
    render(<KpiCard label="Tonnage" value="3 t" />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

// ── BL-P3-02 — légende benchmark + tooltip ──────────────────────────────────
describe('M0.8-47 — BenchmarkLegend rend le barème couleur et un tooltip (BL-P3-02)', () => {
  it('affiche les 4 seuils de lecture + un marqueur info', () => {
    render(<BenchmarkLegend />);
    const legend = screen.getByTestId('benchmark-legende');
    expect(legend).toBeInTheDocument();
    expect(screen.getByText(/≤ 100 %/)).toBeInTheDocument();
    expect(screen.getByText(/100–130 %/)).toBeInTheDocument();
    expect(screen.getByText(/> 130 %/)).toBeInTheDocument();
    expect(screen.getByText(/Données insuffisantes/)).toBeInTheDocument();
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});
