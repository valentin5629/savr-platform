/**
 * R-UI-6c — Q5 (seuil kg → t unique, 10 000 kg, CDC §11 ; scénario 11-12
 * « 9 999 kg puis 10 000 kg ») et Q6 (graphie « kg CO₂e », insécable).
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SEUIL_TONNES_KG, UNITE_KG_CO2E, uniteCo2 } from '@/lib/format';
import { TonnageDisplay } from './TonnageDisplay';
import { fmtMasse } from './charts/cockpit/fmt';

const texte = (kg: number) =>
  render(<TonnageDisplay kg={kg} />).container.textContent?.replace(/\s/g, ' ');

describe('R-UI-6c — Q5 seuil kg → t', () => {
  it('seuil unique = 10 000 kg', () => {
    expect(SEUIL_TONNES_KG).toBe(10_000);
  });

  it('TonnageDisplay : 9 999 kg reste en kg, 10 000 kg passe en t', () => {
    expect(texte(9999)).toBe('9 999 kg');
    expect(texte(10_000)).toBe('10 t');
    expect(texte(3400)).toBe('3 400 kg');
  });

  it('fmtMasse (cockpit) bascule au même seuil', () => {
    expect(fmtMasse(9999).unit).toBe('kg');
    // Scénario 11-12 : 10 000 kg → « 10 t » (0-1 décimale, comme TonnageDisplay).
    expect(fmtMasse(10_000)).toEqual({ value: '10', unit: 't' });
    expect(fmtMasse(48_600)).toEqual({ value: '48,6', unit: 't' });
  });
});

describe('R-UI-6c — Q6 graphie CO₂', () => {
  it('« kg CO₂e » avec espace insécable', () => {
    expect(UNITE_KG_CO2E).toBe('kg\u00a0CO₂e');
    expect(uniteCo2('t')).toBe('t\u00a0CO₂e');
  });
});
