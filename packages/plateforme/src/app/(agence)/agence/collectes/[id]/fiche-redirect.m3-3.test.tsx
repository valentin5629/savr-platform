/**
 * M3.3 — La fiche collecte agence passe dans le pop-up client commun (refonte Val
 * 2026-09-29). La route /agence/collectes/[id] redirige vers
 * /agence/collectes?collecte=<id> : les liens des emails, des dashboards et du
 * détail événement restent valides. Ce test verrouille la redirection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import FicheCollecteAgenceRedirect from './page';

const appel = (id: string, sp: Record<string, string> = {}) =>
  FicheCollecteAgenceRedirect({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(sp),
  });

describe('M3.3 — route fiche collecte agence [id] → pop-up', () => {
  beforeEach(() => redirectMock.mockClear());

  it('M3.3/fiche_redirect_modale — redirige vers /agence/collectes?collecte=<id>', async () => {
    await appel('c-123');
    expect(redirectMock).toHaveBeenCalledWith(
      '/agence/collectes?collecte=c-123',
    );
  });

  it('M3.3/fiche_redirect_edit — conserve l’ouverture en édition (?edit=1)', async () => {
    await appel('c-123', { edit: '1' });
    expect(redirectMock).toHaveBeenCalledWith(
      '/agence/collectes?collecte=c-123&edit=1',
    );
  });

  it('M3.3/fiche_redirect_encode — encode l’id', async () => {
    await appel('a b/c');
    expect(redirectMock).toHaveBeenCalledWith(
      '/agence/collectes?collecte=a+b%2Fc',
    );
  });
});
