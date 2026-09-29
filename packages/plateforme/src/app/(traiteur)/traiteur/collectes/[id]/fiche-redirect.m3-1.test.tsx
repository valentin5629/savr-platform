/**
 * M3.1 — La fiche collecte traiteur passe en pop-up sur la liste (même format
 * que la fiche Admin, décision Val 2026-09-29). La route /traiteur/collectes/[id]
 * redirige vers /traiteur/collectes?collecte=<id> : les liens des emails et des
 * dashboards restent valides. Ce test verrouille la redirection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import FicheCollecteTraiteurRedirect from './page';

const appel = (id: string, sp: Record<string, string> = {}) =>
  FicheCollecteTraiteurRedirect({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(sp),
  });

describe('M3.1 — route fiche collecte traiteur [id] → redirection modale', () => {
  beforeEach(() => redirectMock.mockClear());

  it('M3.1/fiche_redirect_modale — redirige vers /traiteur/collectes?collecte=<id>', async () => {
    await appel('c-123');
    expect(redirectMock).toHaveBeenCalledWith(
      '/traiteur/collectes?collecte=c-123',
    );
  });

  it('M3.1/fiche_redirect_edit — conserve l’ouverture en édition (?edit=1)', async () => {
    await appel('c-123', { edit: '1' });
    expect(redirectMock).toHaveBeenCalledWith(
      '/traiteur/collectes?collecte=c-123&edit=1',
    );
  });

  it('M3.1/fiche_redirect_encode — encode l’id', async () => {
    await appel('a b/c');
    expect(redirectMock).toHaveBeenCalledWith(
      '/traiteur/collectes?collecte=a+b%2Fc',
    );
  });
});
