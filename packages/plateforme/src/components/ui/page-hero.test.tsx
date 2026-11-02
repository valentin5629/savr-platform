/**
 * PageHero — le logo de l'organisation a quitté le bandeau pour la barre navy
 * du haut (Val 2026-11-02, cf. top-bar.test.tsx).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHero } from './page-hero';
import { IdentiteProvider } from '@/components/layout/logo-organisation';
import type { IdentiteSession } from '@/lib/identite-session';

const identite: IdentiteSession = {
  organisation: 'Kaspia',
  logoSrc: '/api/v1/mon-organisation/logo?v=1',
  logoAffichable: true,
  utilisateur: 'Camille Martin',
  poste: null,
};

function rendre(id: IdentiteSession | null, actions?: React.ReactNode) {
  return render(
    <IdentiteProvider value={id}>
      <PageHero title="Dashboard" actions={actions} />
    </IdentiteProvider>,
  );
}

describe('PageHero — sans logo de l’organisation', () => {
  it('le logo est dans la barre du haut, plus dans le bandeau (Val 2026-11-02)', () => {
    rendre(identite, <button>Exporter</button>);
    expect(screen.queryByTestId('logo-organisation')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Exporter' }),
    ).toBeInTheDocument();
  });
});
