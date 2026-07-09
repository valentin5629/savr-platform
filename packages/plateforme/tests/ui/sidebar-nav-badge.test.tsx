/**
 * UI — pastille de compteur sur la nav Admin (follow-up R22e). L'entrée
 * « Alertes » rend le compteur d'alertes ouvertes visible (le gap était : table
 * peuplée, aucun signal de lecture). Vérifie l'entrée nav + le rendu de la
 * pastille pilotée par navBadges.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Sidebar } from '@/components/layout/sidebar';
import { NAV_CONFIG } from '@/lib/nav-config';

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
}));

afterEach(() => cleanup());

describe('nav-config — entrée Alertes Admin', () => {
  it('admin_savr a une entrée « Alertes » → /admin/alertes', () => {
    const items = NAV_CONFIG.admin_savr.flatMap((g) => g.items);
    const alertes = items.find((i) => i.href === '/admin/alertes');
    expect(alertes).toBeDefined();
    expect(alertes?.label).toBe('Alertes');
  });
});

describe('Sidebar — pastille navBadges', () => {
  it('rend le compteur quand navBadges > 0', () => {
    render(<Sidebar role="admin_savr" navBadges={{ '/admin/alertes': 3 }} />);
    expect(screen.getByLabelText('3 alertes ouvertes')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('99+ au-delà de 99', () => {
    render(<Sidebar role="admin_savr" navBadges={{ '/admin/alertes': 150 }} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('aucune pastille quand compteur = 0 ou absent', () => {
    render(<Sidebar role="admin_savr" navBadges={{ '/admin/alertes': 0 }} />);
    expect(screen.queryByText('0')).toBeNull();
  });
});
