/**
 * TopBar — titre et notifications seulement (Val 2026-10-30) : l'organisation,
 * l'utilisateur et « Se déconnecter » sont en bas de la Sidebar
 * (cf. sidebar-deconnexion.test.tsx).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TopBar } from './top-bar';

describe('TopBar', () => {
  it('affiche le titre et les notifications, sans identité ni déconnexion', () => {
    render(<TopBar title="Espace gestionnaire de lieux" />);
    expect(
      screen.getByRole('heading', { name: 'Espace gestionnaire de lieux' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Notifications' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
