/**
 * M3.2 — La fiche événement du gestionnaire passe en pop-up sur la liste
 * Événements (demande Val 2026-10-19, « en modale comme les pages collectes »).
 * La route /gestionnaire/evenements/[id] redirige vers
 * /gestionnaire/evenements?evenement=<id> : liens directs et favoris restent
 * valides. Ce test verrouille la redirection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import FicheEvenementGestionnaireRedirect from './page';

const appel = (id: string, sp: Record<string, string> = {}) =>
  FicheEvenementGestionnaireRedirect({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(sp),
  });

describe('M3.2 — route fiche événement gestionnaire [id] → pop-up', () => {
  beforeEach(() => redirectMock.mockClear());

  it('M3.2/evenement_fiche_redirect_modale — redirige vers /gestionnaire/evenements?evenement=<id>', async () => {
    await appel('e-123');
    expect(redirectMock).toHaveBeenCalledWith(
      '/gestionnaire/evenements?evenement=e-123',
    );
  });

  it('M3.2/evenement_fiche_redirect_collecte — garde la fiche collecte ouverte (?collecte=)', async () => {
    await appel('e-123', { collecte: 'c-9' });
    expect(redirectMock).toHaveBeenCalledWith(
      '/gestionnaire/evenements?evenement=e-123&collecte=c-9',
    );
  });

  it('M3.2/evenement_fiche_redirect_encode — encode l’id', async () => {
    await appel('a b/c');
    expect(redirectMock).toHaveBeenCalledWith(
      '/gestionnaire/evenements?evenement=a+b%2Fc',
    );
  });
});
