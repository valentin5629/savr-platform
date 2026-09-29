/**
 * M3.2 — La fiche collecte gestionnaire passe dans le pop-up client commun (refonte Val
 * 2026-09-29). La route /gestionnaire/collectes/[id] redirige vers
 * /gestionnaire/collectes?collecte=<id> : les liens des emails, des dashboards et du
 * détail événement restent valides. Ce test verrouille la redirection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import FicheCollecteGestionnaireRedirect from './page';

const appel = (id: string, sp: Record<string, string> = {}) =>
  FicheCollecteGestionnaireRedirect({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(sp),
  });

describe('M3.2 — route fiche collecte gestionnaire [id] → pop-up', () => {
  beforeEach(() => redirectMock.mockClear());

  it('M3.2/fiche_redirect_modale — redirige vers /gestionnaire/collectes?collecte=<id>', async () => {
    await appel('c-123');
    expect(redirectMock).toHaveBeenCalledWith(
      '/gestionnaire/collectes?collecte=c-123',
    );
  });

  it('M3.2/fiche_redirect_edit — conserve l’ouverture en édition (?edit=1)', async () => {
    await appel('c-123', { edit: '1' });
    expect(redirectMock).toHaveBeenCalledWith(
      '/gestionnaire/collectes?collecte=c-123&edit=1',
    );
  });

  it('M3.2/fiche_redirect_encode — encode l’id', async () => {
    await appel('a b/c');
    expect(redirectMock).toHaveBeenCalledWith(
      '/gestionnaire/collectes?collecte=a+b%2Fc',
    );
  });
});
