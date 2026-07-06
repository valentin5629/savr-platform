/**
 * M3.5 — Composants graphiques partagés §11 (BL-P1-PARITE-01).
 * Bloc 2 ZD (barres empilées 5 flux + courbe taux), Bloc 2 AG (courbe repas/ratio),
 * Bloc 4 ZD (donut répartition + total centre). recharts est mocké (le rendu SVG
 * dépend d'une taille non disponible en jsdom) : on teste la LÉGENDE / le RÉSUMÉ /
 * l'état vide / l'interaction, DOM que les composants rendent hors de recharts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// recharts est aliasé vers un stub léger dans vitest.config.ts (le vrai recharts
// hang vitest via ResizeObserver). On teste la LÉGENDE / le RÉSUMÉ / l'état vide /
// l'interaction — DOM que les composants rendent HORS recharts.
import { EvolutionFluxChart } from './EvolutionFluxChart.js';
import { EvolutionRepasChart } from './EvolutionRepasChart.js';
import { TonnagesDonut } from './TonnagesDonut.js';
import type { FluxSeriePoint, RepasSeriePoint } from '../useEvolutionBlocs.js';

const zdSeries: FluxSeriePoint[] = [
  {
    periode: '2026-05-01',
    biodechet: 300,
    emballage: 100,
    carton: 50,
    verre: 25,
    dechet_residuel: 25,
    tonnage_total: 500,
    taux_recyclage: 80,
  },
  {
    periode: '2026-06-01',
    biodechet: 400,
    emballage: 100,
    carton: 0,
    verre: 0,
    dechet_residuel: 0,
    tonnage_total: 500,
    taux_recyclage: 90,
  },
];

const agSeries: RepasSeriePoint[] = [
  { periode: '2026-05-01', repas_donnes: 120, pax: 300, ratio: 0.4 },
  { periode: '2026-06-01', repas_donnes: 200, pax: 400, ratio: 0.5 },
];

beforeEach(() => cleanup());

describe('M3.5 / charts §11 — Bloc 2 ZD (EvolutionFluxChart)', () => {
  it('M3.5/chart_flux_legende_5_flux — légende des 5 flux ZD rendue', () => {
    render(<EvolutionFluxChart series={zdSeries} granularite="mois" />);
    expect(screen.getByTestId('evolution-flux-chart')).toBeTruthy();
    const legend = screen.getByTestId('evolution-flux-legend');
    for (const label of [
      'Biodéchets',
      'Emballages',
      'Cartons',
      'Verre',
      'Déchet résiduel',
    ]) {
      expect(legend.textContent).toContain(label);
    }
    // Courbe taux référencée dans la légende.
    expect(legend.textContent).toContain('Taux de recyclage');
  });

  it('M3.5/chart_flux_legende_cliquable — un clic bascule aria-pressed', () => {
    render(<EvolutionFluxChart series={zdSeries} granularite="mois" />);
    const bio = screen.getByRole('button', { name: /Biodéchets/ });
    expect(bio.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(bio);
    expect(bio.getAttribute('aria-pressed')).toBe('false');
  });

  it('M3.5/chart_flux_vide — état vide si aucune donnée', () => {
    render(<EvolutionFluxChart series={[]} granularite="mois" />);
    expect(screen.getByTestId('evolution-flux-chart').textContent).toContain(
      'Aucune donnée',
    );
  });
});

describe('M3.5 / charts §11 — Bloc 2 AG (EvolutionRepasChart)', () => {
  it('M3.5/chart_repas_legende — repas donnés + ratio repas/pax', () => {
    render(<EvolutionRepasChart series={agSeries} granularite="mois" />);
    const legend = screen.getByTestId('evolution-repas-legend');
    expect(legend.textContent).toContain('Repas donnés');
    expect(legend.textContent).toContain('Repas/pax');
  });

  it('M3.5/chart_repas_vide — état vide', () => {
    render(<EvolutionRepasChart series={[]} granularite="mois" />);
    expect(screen.getByTestId('evolution-repas-chart').textContent).toContain(
      'Aucune donnée',
    );
  });
});

describe('M3.5 / charts §11 — Bloc 4 ZD (TonnagesDonut)', () => {
  it('M3.5/chart_donut_total_centre — total au centre = somme des flux', () => {
    render(<TonnagesDonut series={zdSeries} />);
    // 500 + 500 = 1000 kg
    expect(screen.getByTestId('tonnages-donut-total').textContent).toContain(
      '1',
    );
    const legend = screen.getByTestId('tonnages-donut-legend');
    expect(legend.textContent).toContain('Biodéchets');
    // Part relative affichée (%)
    expect(legend.textContent).toContain('%');
  });

  it('M3.5/chart_donut_vide — état vide si tonnage nul', () => {
    render(<TonnagesDonut series={[]} />);
    expect(screen.getByTestId('tonnages-donut').textContent).toContain(
      'Aucune donnée',
    );
  });
});
