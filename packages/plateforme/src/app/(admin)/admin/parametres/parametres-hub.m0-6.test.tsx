/**
 * M0.6 — Hub Paramètres (BL-P2-06 nav / désorphelinage des écrans §9)
 * Vérifie que le hub /admin/parametres expose les liens vers les sous-sections
 * (grilles-zd, tarifs-ag, taux-recyclage, co2, algo-ag, auto-accept, templates,
 * utilisateurs) — auparavant accessibles par URL seule.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import ParametresIndexPage from './page';

describe('M0.6 — Paramètres hub', () => {
  it('M0.6/parametres/hub — liste les sous-sections §9 avec leurs liens', () => {
    render(<ParametresIndexPage />);
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/admin/parametres/grilles-zd');
    expect(hrefs).toContain('/admin/parametres/tarifs-ag');
    expect(hrefs).toContain('/admin/parametres/taux-recyclage');
    expect(hrefs).toContain('/admin/parametres/templates');
    expect(hrefs).toContain('/admin/settings/users');
    expect(screen.getByText('Grilles tarifaires ZD')).toBeDefined();
  });
});
