/**
 * Page /mentions-legales — mentions exigées par la LCEN (art. 6-III) et par la
 * checklist go-live du CDC (§15 « Mentions légales publiées »).
 *
 * Ce que ces tests garantissent : éditeur complet (forme, capital, siège, RCS,
 * TVA, contact), directeur de la publication et hébergeur présents, aucune
 * valeur provisoire publiée, et page liée depuis les écrans d'authentification.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import MentionsLegalesPage from '@/app/mentions-legales/page.js';
import { AuthPage } from '@/components/auth/auth-card';
import { CAPITAL_SOCIAL_SAVR } from '@/content/mentions-legales';

afterEach(cleanup);

describe('/mentions-legales : contenu exigé par la LCEN', () => {
  it("rend l'éditeur, le directeur de la publication et l'hébergeur", () => {
    const { container } = render(<MentionsLegalesPage />);
    const texte = container.textContent ?? '';
    for (const attendu of [
      'Éditeur',
      'société par actions simplifiée',
      '50 rue des Moines, 75017 Paris',
      '879 642 890',
      'FR32879642890',
      '06 59 27 87 73',
      'gestion@gosavr.io',
      'Directeur de la publication',
      'Louis Rauscher de Barbe de La Barthe',
      'Hébergement',
      'Vercel Inc.',
    ]) {
      expect(texte, attendu).toContain(attendu);
    }
  });

  it('publie un capital social chiffré, jamais une valeur provisoire', () => {
    expect(CAPITAL_SOCIAL_SAVR).toMatch(/^\d[\d\s]*(,\d+)?$/);
    const { container } = render(<MentionsLegalesPage />);
    expect(container.textContent).toContain(`${CAPITAL_SOCIAL_SAVR} euros`);
  });
});

describe('écrans d’authentification : lien vers les mentions légales', () => {
  it('le gabarit commun porte le lien /mentions-legales', () => {
    render(
      <AuthPage>
        <p>contenu</p>
      </AuthPage>,
    );
    expect(
      screen.getByRole('link', { name: 'Mentions légales' }),
    ).toHaveAttribute('href', '/mentions-legales');
  });
});
