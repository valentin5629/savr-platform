/**
 * Bloc « Code affaire VIPARIS » des fiches collecte (Val 2026-11-02).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { CodeAffaireViparis } from './code-affaire-viparis';

afterEach(() => vi.unstubAllGlobals());

describe('CodeAffaireViparis', () => {
  it('VIPARIS/bloc_code_affaire_lecture — code affiché, « Modifier » ; sans code : « Ajouter »', () => {
    const { rerender } = render(
      <CodeAffaireViparis evenementId="e1" code="26SIAL1" />,
    );
    expect(screen.getByText('26SIAL1')).toBeInTheDocument();
    expect(screen.getByText('Modifier')).toBeInTheDocument();
    rerender(<CodeAffaireViparis evenementId="e1" code={null} />);
    expect(screen.getByText('Ajouter')).toBeInTheDocument();
  });

  it('VIPARIS/bloc_code_affaire_lecture_seule — modifiable=false : aucun bouton', () => {
    render(
      <CodeAffaireViparis evenementId="e1" code="26SIAL1" modifiable={false} />,
    );
    expect(screen.queryByText('Modifier')).not.toBeInTheDocument();
  });

  it(
    'VIPARIS/bloc_code_affaire_enregistre — PATCH sur la route de l’événement, code normalisé puis affiché',
    async () => {
      const fetchMock = vi.fn(async () =>
        Response.json({ data: { id: 'e1', code_affaire_viparis: '26SIAL1' } }),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(<CodeAffaireViparis evenementId="e1" code={null} />);
      fireEvent.click(screen.getByText('Ajouter'));
      fireEvent.change(screen.getByLabelText('Code affaire VIPARIS'), {
        target: { value: ' 26sial1 ' },
      });
      fireEvent.click(screen.getByText('Enregistrer'));
      await waitFor(
        () => expect(screen.getByText('26SIAL1')).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/evenements/e1/code-affaire-viparis',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ code_affaire_viparis: '26SIAL1' }),
        }),
      );
    },
    ATTENTE_CAS_MS,
  );

  it('VIPARIS/bloc_code_affaire_format — format invalide : message, aucun appel', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CodeAffaireViparis evenementId="e1" code={null} />);
    fireEvent.click(screen.getByText('Ajouter'));
    fireEvent.change(screen.getByLabelText('Code affaire VIPARIS'), {
      target: { value: '26SIA' },
    });
    fireEvent.click(screen.getByText('Enregistrer'));
    expect(
      screen.getByText(
        'Le code affaire VIPARIS compte 7 lettres ou chiffres (ex. 26SIAL1).',
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it(
    'VIPARIS/bloc_code_affaire_refus — refus de la route : son message, saisie gardée',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { error: 'Événement introuvable ou accès refusé' },
            { status: 404 },
          ),
        ),
      );
      render(<CodeAffaireViparis evenementId="e1" code={null} />);
      fireEvent.click(screen.getByText('Ajouter'));
      fireEvent.change(screen.getByLabelText('Code affaire VIPARIS'), {
        target: { value: '26SIAL1' },
      });
      fireEvent.click(screen.getByText('Enregistrer'));
      await waitFor(
        () =>
          expect(
            screen.getByText('Événement introuvable ou accès refusé'),
          ).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(screen.getByLabelText('Code affaire VIPARIS')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
