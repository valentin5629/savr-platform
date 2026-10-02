// R-UI-4b D1 — le segmenté ZD / AG des dashboards est le `ToggleTypeCollecte`
// partagé (ToggleGroup Radix) : items `role=radio`, état `aria-checked`,
// navigation clavier par flèches (absente de l'ancien `CollecteTypeTabs`).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import TestDashboardComponentsPage from '@/app/dev/test-dashboard-components/page';

describe('Dashboards — ToggleTypeCollecte (R-UI-4b D1)', () => {
  it('rend un groupe radio ZD / AG, Zéro Déchet actif par défaut', () => {
    render(<TestDashboardComponentsPage />);
    const groupe = screen.getByRole('radiogroup', { name: 'Type de collecte' });
    const zd = screen.getByRole('radio', { name: 'Zéro Déchet' });
    const ag = screen.getByRole('radio', { name: 'Anti-Gaspi' });
    expect(groupe).toContainElement(zd);
    expect(screen.queryByRole('radio', { name: 'Toutes' })).toBeNull();
    expect(zd).toHaveAttribute('aria-checked', 'true');
    expect(zd).toHaveAttribute('data-state', 'on');
    expect(ag).toHaveAttribute('aria-checked', 'false');
  });

  it('clic sur Anti-Gaspi change le type ; re-clic ne le désélectionne pas', () => {
    render(<TestDashboardComponentsPage />);
    const ag = screen.getByRole('radio', { name: 'Anti-Gaspi' });
    fireEvent.click(ag);
    expect(ag).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Onglet actif : anti_gaspi')).toBeInTheDocument();
    // Type obligatoire sur les dashboards : un clic sur l'item actif est ignoré.
    fireEvent.click(ag);
    expect(ag).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Onglet actif : anti_gaspi')).toBeInTheDocument();
  });

  it(
    'les flèches déplacent le focus entre les deux types',
    async () => {
      render(<TestDashboardComponentsPage />);
      const zd = screen.getByRole('radio', { name: 'Zéro Déchet' });
      const ag = screen.getByRole('radio', { name: 'Anti-Gaspi' });
      zd.focus();
      expect(zd).toHaveFocus();
      // Roving focus Radix : le déplacement est différé (setTimeout).
      fireEvent.keyDown(zd, { key: 'ArrowRight' });
      await waitFor(() => expect(ag).toHaveFocus(), ATTENTE_UI);
      fireEvent.keyDown(ag, { key: 'ArrowLeft' });
      await waitFor(() => expect(zd).toHaveFocus(), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});
