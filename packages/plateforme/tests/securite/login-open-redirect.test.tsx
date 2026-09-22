/**
 * Cliquet — open redirect post-login.
 *
 * `/login` redirigeait vers `?next=` sans validation : `/login?next=https://evil.example`
 * envoyait l'utilisateur hors du domaine juste après sa connexion (lien de
 * phishing crédible). Seul un chemin interne est désormais suivi, sinon `/`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

const push = vi.fn();
const refresh = vi.fn();
let params = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  useSearchParams: () => params,
}));

import LoginPage from '@/app/login/page.js';
import { safeNextPath } from '@/lib/safe-next-path.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

async function seConnecter(next: string | null): Promise<void> {
  params = new URLSearchParams(next === null ? '' : { next });
  const { container } = render(<LoginPage />);
  fireEvent.change(container.querySelector('input[type="email"]')!, {
    target: { value: 'marie@traiteur.fr' },
  });
  fireEvent.change(container.querySelector('input[type="password"]')!, {
    target: { value: 'motdepasse' },
  });
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1), ATTENTE_UI);
}

const EXTERNES: Array<[string, string]> = [
  ['URL absolue', 'https://evil.example'],
  ['protocol-relative', '//evil.example'],
  ['antislash', '/\\evil.example'],
  ['javascript:', 'javascript:alert(1)'],
  ['// encodé', '/%2F%2Fevil.example'],
  ['/\\ encodé', '/%5Cevil.example'],
  ['entièrement encodé', '%2F%2Fevil.example'],
  ['tab retiré par le parseur (/\\t/ → //)', '/\t/evil.example'],
  ['saut de ligne', '/\n/evil.example'],
  ['encodage invalide', '/%E0%A4%A'],
  ['relatif sans /', 'evil.example'],
];

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('login — `next` externe refusé (open redirect)', () => {
  it.each(EXTERNES)(
    '%s → push("/")',
    async (_cas, next) => {
      await seConnecter(next);
      expect(push).toHaveBeenCalledWith('/');
    },
    ATTENTE_CAS_MS,
  );

  it(
    '`next` absent → push("/") (espace du rôle)',
    async () => {
      await seConnecter(null);
      expect(push).toHaveBeenCalledWith('/');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'chemin interne → push tel quel',
    async () => {
      await seConnecter('/admin/collectes');
      expect(push).toHaveBeenCalledWith('/admin/collectes');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'chemin interne avec query → conservée',
    async () => {
      await seConnecter('/admin/collectes?onglet=ag');
      expect(push).toHaveBeenCalledWith('/admin/collectes?onglet=ag');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'identifiants refusés → aucune redirection',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: 'Identifiants incorrects' }), {
              status: 401,
            }),
        ),
      );
      params = new URLSearchParams({ next: '/admin/collectes' });
      const { container, findByText } = render(<LoginPage />);
      fireEvent.submit(container.querySelector('form')!);
      await findByText('Identifiants incorrects', undefined, ATTENTE_UI);
      expect(push).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );
});

describe('safeNextPath', () => {
  it.each(EXTERNES)('%s → "/"', (_cas, next) => {
    expect(safeNextPath(next)).toBe('/');
  });

  it.each([null, undefined, ''])('%j → "/"', (next) => {
    expect(safeNextPath(next)).toBe('/');
  });

  it.each(['/', '/admin/collectes', '/traiteur/collectes/abc?x=1#frag'])(
    '%s → inchangé',
    (next) => {
      expect(safeNextPath(next)).toBe(next);
    },
  );
});
