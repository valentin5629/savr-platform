/**
 * Page /confidentialite — politique de confidentialité (CDC §15, 3.4).
 *
 * Ce que ces tests garantissent : la page couvre ce que le CDC exige (données,
 * usage, durées, destinataires, droits, contact), donne l'adresse de contact
 * des CGU (art. 24.7), n'affirme aucune donnée bancaire (la plateforme n'en
 * stocke pas), et reste liée depuis les écrans d'authentification.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

import ConfidentialitePage from '@/app/confidentialite/page.js';
import { AuthPage } from '@/components/auth/auth-card';
import { POLITIQUE_CONFIDENTIALITE_MISE_A_JOUR } from '@/content/politique-confidentialite';

afterEach(cleanup);

describe('/confidentialite : contenu exigé par le CDC §15 3.4', () => {
  it('rend les sections attendues et la date de mise à jour', () => {
    render(<ConfidentialitePage />);
    for (const titre of [
      'Qui sommes-nous',
      'Données traitées et durées de conservation',
      'Destinataires',
      'Cookies',
      'Sécurité',
      'Vos droits',
    ]) {
      expect(
        screen.getByRole('heading', { level: 2, name: titre }),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        `Mise à jour : ${POLITIQUE_CONFIDENTIALITE_MISE_A_JOUR}.`,
      ),
    ).toBeInTheDocument();
  });

  it('donne le contact des droits des CGU (art. 24.7) et la CNIL', () => {
    const { container } = render(<ConfidentialitePage />);
    expect(container.textContent).toContain('gestion@gosavr.io');
    expect(container.textContent).toContain('CNIL');
  });

  it("n'annonce aucune donnée bancaire : la plateforme n'en stocke pas", () => {
    const { container } = render(<ConfidentialitePage />);
    expect(container.textContent).not.toMatch(
      /bancaire|IBAN|carte de paiement/i,
    );
  });

  it('les durées de conservation du CDC §15 3.2 sont publiées', () => {
    const { container } = render(<ConfidentialitePage />);
    const texte = container.textContent ?? '';
    expect(texte).toContain('pendant la durée du compte, puis 3 ans');
    expect(texte).toContain('conservées 10 ans');
    expect(texte).toContain("un an après l'événement");
    expect(texte).toContain('journal conservé 5 ans');
  });
});

describe('écrans d’authentification : lien vers la politique', () => {
  it('le gabarit commun porte le lien /confidentialite', () => {
    render(
      <AuthPage>
        <p>contenu</p>
      </AuthPage>,
    );
    expect(
      screen.getByRole('link', { name: 'Politique de confidentialité' }),
    ).toHaveAttribute('href', '/confidentialite');
  });
});
