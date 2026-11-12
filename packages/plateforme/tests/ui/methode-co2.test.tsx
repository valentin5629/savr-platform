/**
 * Page /methode-co2 — méthode de calcul du CO₂, publique (Val 2026-11-10,
 * guide anti-greenwashing Climeet).
 *
 * Ce que ces tests garantissent : la page répond aux questions d'un chiffre
 * honnête (périmètre, méthode, fiabilité), couvre la collecte des déchets et
 * l'Anti-Gaspi, cite les valeurs appliquées par la base, ne présente jamais
 * de bilan net ni de taux de recyclage comme mesuré.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import MethodeCo2Page from '@/app/methode-co2/page.js';
import {
  METHODE_CO2_MISE_A_JOUR,
  METHODE_CO2_SECTIONS,
} from '@/content/methode-co2';

afterEach(cleanup);

const texteComplet = () =>
  METHODE_CO2_SECTIONS.flatMap((s) =>
    s.blocs.map((b) => b.segments.map((g) => g.texte).join('')),
  ).join('\n');

describe('/methode-co2 : page publique de méthode', () => {
  it('rend les sections attendues et la date de mise à jour', () => {
    render(<MethodeCo2Page />);
    for (const titre of [
      'En bref',
      'Ce que Savr calcule',
      'Collecte des déchets triés : les facteurs',
      'Taux de recyclage estimé',
      'Dons anti-gaspi',
      'Équivalences',
      'Limites et mises à jour',
      'Vérifier nos sources',
    ]) {
      expect(
        screen.getByRole('heading', { level: 2, name: titre }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByText(new RegExp(`Mise à jour : ${METHODE_CO2_MISE_A_JOUR}`)),
    ).toBeInTheDocument();
  });

  it('dit le périmètre, la source et la part estimée', () => {
    const t = texteComplet();
    expect(t).toMatch(/ne portent que sur les déchets et excédents/);
    expect(t).toMatch(/ne mesurent pas l’empreinte carbone d’un événement/);
    expect(t).toMatch(/Base Carbone® de l’ADEME \(version 23\.6\)/);
    expect(t).toMatch(/Données mesurées/);
    expect(t).toMatch(/Données estimées/);
  });

  it('cite les valeurs appliquées (facteurs, forfait, captation, Anti-Gaspi)', () => {
    const t = texteComplet();
    for (const v of [
      '639 / 1 158',
      '992 / 379',
      '173 / 12',
      '715 / 921',
      '374 / 212',
      '25 km aller-retour × 0,4 kg CO₂e/km',
      'verre 95 %, carton 90 %, biodéchets 85 %, emballages 60 %',
      '0,45 kg par repas',
      '2,04 kg CO₂e',
      '2,5 kg CO₂e par repas (FAO)',
    ]) {
      expect(t).toContain(v);
    }
  });

  it('ne soustrait jamais évité et induit, ne promet aucun taux mesuré', () => {
    const t = texteComplet();
    expect(t).not.toMatch(/bilan net|CO₂ net|neutre|compens/i);
    expect(t).not.toMatch(/effectivement recyclée/);
    expect(t).toMatch(/ne sont pas mesurées collecte par collecte/);
  });
});
