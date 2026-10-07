/**
 * R-UI-5 G4 — modale « Détail de l'impact carbone » unique (ex-4 instances
 * recopiées dans les dashboards traiteur et client Admin, ZD + AG).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Co2DetailModal } from './Co2DetailModal';
import { FACTEURS_CO2_DEFAUT } from '@/lib/dashboards/cockpit-derive';

const CO2 = { eviteKg: 1200, induitKg: 100, netKg: 1100, energieKwh: 5000 };

describe('R-UI-5 G4 — Co2DetailModal', () => {
  it('ZD : période, collectes clôturées Zéro Déchet, héros complet + méthode ADEME', () => {
    const onClose = vi.fn();
    render(
      <Co2DetailModal
        open
        onClose={onClose}
        type="zero_dechet"
        from="2026-01-01"
        to="2026-03-31"
        nbCollectes={3}
        co2={CO2}
        facteursCo2={FACTEURS_CO2_DEFAUT}
        co2Methode={undefined}
      />,
    );
    const dialogue = screen.getByRole('dialog', {
      name: "Détail de l'impact carbone",
    });
    expect(dialogue.className).toMatch(/\bmax-w-3xl\b/);
    expect(dialogue.textContent).toContain(
      'Période analysée : du 01/01/2026 au 31/03/2026 · 3 collectes clôturées Zéro Déchet',
    );
    // Héros ZD : lignes induit / bilan net présentes (variante AG : évité seul).
    expect(screen.getAllByText('CO₂ induit').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('AG : singulier, Anti-Gaspi, méthode par repas (facteur par défaut 2,5)', () => {
    render(
      <Co2DetailModal
        open
        onClose={() => {}}
        type="anti_gaspi"
        nbCollectes={1}
        co2={CO2}
        facteursCo2={FACTEURS_CO2_DEFAUT}
        co2Methode={undefined}
        repasDonnes={480}
      />,
    );
    const dialogue = screen.getByRole('dialog');
    expect(dialogue.textContent).toContain(
      'Période analysée : du — au — · 1 collecte clôturée Anti-Gaspi',
    );
    expect(screen.queryAllByText('CO₂ induit')).toHaveLength(0);
    expect(dialogue.textContent).toContain('2,5');
  });

  it('fermée : rien n’est rendu', () => {
    render(
      <Co2DetailModal
        open={false}
        onClose={() => {}}
        type="zero_dechet"
        nbCollectes={0}
        co2={CO2}
        facteursCo2={FACTEURS_CO2_DEFAUT}
        co2Methode={undefined}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
