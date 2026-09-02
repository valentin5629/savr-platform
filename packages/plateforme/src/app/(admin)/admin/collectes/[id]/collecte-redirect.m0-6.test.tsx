/**
 * M0.6 — La fiche collecte Admin passe en pop-up centré (modale) sur la liste.
 * La route /admin/collectes/[id] ne rend plus de page : elle redirige vers
 * /admin/collectes?collecte=<id> pour préserver les liens profonds (emails,
 * favoris, drill-down dashboards). Ce test verrouille cette redirection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import CollecteDetailRedirect from './page';

describe('M0.6 — route fiche collecte [id] → redirection modale (BL-P1-BOA-06)', () => {
  beforeEach(() => redirectMock.mockClear());

  it('M0.6 — redirige vers /admin/collectes?collecte=<id>', async () => {
    await CollecteDetailRedirect({ params: Promise.resolve({ id: 'c-123' }) });
    expect(redirectMock).toHaveBeenCalledWith(
      '/admin/collectes?collecte=c-123',
    );
  });

  it('M0.6 — encode l’id dans le paramètre de requête', async () => {
    await CollecteDetailRedirect({ params: Promise.resolve({ id: 'a b/c' }) });
    expect(redirectMock).toHaveBeenCalledWith(
      '/admin/collectes?collecte=a%20b%2Fc',
    );
  });
});
