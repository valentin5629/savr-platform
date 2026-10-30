/**
 * TopBar — organisation en haut à droite (Val 2026-10-30) : avatar rond (logo de
 * l'organisation, ou ses initiales) + nom. « Se déconnecter » n'est plus ici :
 * il est en bas de la Sidebar (cf. sidebar.test.tsx).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { TopBar } from './top-bar';

describe('TopBar — organisation en en-tête', () => {
  it('affiche le logo de l’organisation en avatar, avec son nom', () => {
    render(
      <TopBar
        title="Espace gestionnaire de lieux"
        userName="a@b.c"
        organisation={{
          nom: 'Viparis',
          logoSrc: '/api/v1/mon-organisation/logo?v=1',
        }}
      />,
    );
    const bloc = screen.getByTestId('organisation-entete');
    expect(within(bloc).getByText('Viparis')).toBeInTheDocument();
    const img = bloc.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/v1/mon-organisation/logo?v=1');
    // L'email n'est plus affiché quand l'organisation est connue.
    expect(screen.queryByText('a@b.c')).not.toBeInTheDocument();
  });

  it('sans logo : initiales de l’organisation dans l’avatar', () => {
    render(
      <TopBar organisation={{ nom: 'Pavillon Gabriel', logoSrc: null }} />,
    );
    const avatar = screen.getByTestId('avatar-organisation');
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar).toHaveTextContent('PG');
  });

  it('logo introuvable : retombe sur les initiales', () => {
    render(
      <TopBar organisation={{ nom: 'Viparis', logoSrc: '/api/v1/x?v=1' }} />,
    );
    const avatar = screen.getByTestId('avatar-organisation');
    fireEvent.error(avatar.querySelector('img')!);
    expect(avatar.querySelector('img')).toBeNull();
    expect(avatar).toHaveTextContent('V');
  });

  it('sans organisation (staff) : l’email reste affiché', () => {
    render(<TopBar title="Back-office Admin" userName="admin@savr.fr" />);
    expect(screen.getByText('admin@savr.fr')).toBeInTheDocument();
    expect(screen.queryByTestId('organisation-entete')).toBeNull();
  });

  it('plus de bouton « Se déconnecter » dans l’en-tête', () => {
    render(<TopBar organisation={{ nom: 'Viparis', logoSrc: null }} />);
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
  });
});
