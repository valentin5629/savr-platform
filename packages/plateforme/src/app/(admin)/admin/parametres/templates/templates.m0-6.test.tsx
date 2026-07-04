/**
 * M0.6 — Page Templates emails (lecture seule, BL-P2-07)
 * Vérifie : liste des templates actifs + compteur, aperçu (variables + iframe corps).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import TemplatesEmailPage from './page';

const templates = [
  {
    id: 't-1',
    code: 'confirmation_collecte',
    sujet: 'Votre collecte est confirmée',
    description: 'Envoyé à la validation',
    variables: ['prenom', 'date_collecte'],
    corps_html: '<p>Bonjour {{prenom}}</p>',
    actif: true,
  },
  {
    id: 't-2',
    code: 'facture_emise',
    sujet: 'Votre facture Savr',
    description: null,
    variables: ['numero_facture'],
    corps_html: '<p>Facture {{numero_facture}}</p>',
    actif: true,
  },
];

beforeEach(() => {
  global.fetch = vi.fn(
    () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ data: templates }),
      }) as unknown as Promise<Response>,
  ) as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe('M0.6 — Templates emails page', () => {
  it('M0.6/templates/page — rend la liste + le compteur de templates actifs', async () => {
    render(<TemplatesEmailPage />);
    // facture_emise n'est pas sélectionné → n'apparaît que dans la liste (unique).
    await waitFor(() =>
      expect(screen.getByText('facture_emise')).toBeDefined(),
    );
    expect(screen.getByText(/2 templates actifs/)).toBeDefined();
    // confirmation_collecte (sélectionné) apparaît en liste + aperçu.
    expect(screen.getAllByText('confirmation_collecte').length).toBeGreaterThan(
      0,
    );
  });

  it('M0.6/templates/page — affiche variables + aperçu iframe du template sélectionné', async () => {
    render(<TemplatesEmailPage />);
    // variables du 1er template (sélectionné par défaut) — uniques à l'aperçu
    await waitFor(() => expect(screen.getByText('prenom')).toBeDefined());
    expect(screen.getByText('date_collecte')).toBeDefined();
    // aperçu = iframe read-only sandboxée
    const iframe = screen.getByTitle('Aperçu confirmation_collecte');
    expect(iframe).toBeDefined();
    expect((iframe as HTMLIFrameElement).getAttribute('sandbox')).toBe('');
  });
});
