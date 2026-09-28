/**
 * L'écran de connexion explique les liens d'email qui n'aboutissent pas — y
 * compris quand le motif arrive dans le FRAGMENT de l'URL.
 *
 * Un fragment (`#error_code=…`) n'est JAMAIS transmis au serveur : ni le
 * middleware ni une route ne peuvent le lire. Or c'est précisément là que
 * Supabase place le motif quand il refuse un lien et redirige vers le Site URL
 * du projet.
 *
 * Panne mesurée en dev le 2026-09-24 : l'utilisateur cliquait sur son lien de
 * réinitialisation et tombait sur un formulaire de connexion parfaitement muet.
 * Le seul indice était `#error=access_denied&error_code=otp_expired` dans la
 * barre d'adresse. La PR #401 avait traité les motifs en `?error=` — ceux-ci
 * arrivent autrement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

let params = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => params,
}));

import LoginPage from '@/app/login/page.js';

/** Pose un fragment sur l'URL courante, comme le ferait la redirection GoTrue. */
function poserFragment(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  vi.clearAllMocks();
  params = new URLSearchParams();
  poserFragment('');
});

afterEach(() => {
  cleanup();
  poserFragment('');
});

describe('M0.4 — /login : les motifs arrivés en fragment sont affichés', () => {
  it(
    'lien expiré ou déjà utilisé (#error_code=otp_expired) → message + sortie',
    async () => {
      poserFragment(
        '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      );
      const { container } = render(<LoginPage />);

      await waitFor(
        () => expect(container.textContent).toContain('Ce lien a expiré'),
        ATTENTE_UI,
      );
      expect(container.textContent).toContain('il ne fonctionne qu');
      // La sortie existe : on peut redemander un lien depuis cet écran.
      expect(
        container.querySelector('a[href="/reset-password"]'),
      ).not.toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'refus générique (#error=access_denied seul) → message, jamais un écran muet',
    async () => {
      poserFragment('#error=access_denied');
      const { container } = render(<LoginPage />);

      await waitFor(
        () => expect(container.textContent).toContain('pas pu être vérifié'),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'sans fragment, aucun message ne s’affiche',
    async () => {
      const { container } = render(<LoginPage />);
      await waitFor(
        () => expect(container.textContent).toContain('Connexion à Savr'),
        ATTENTE_UI,
      );
      expect(container.textContent).not.toContain('Ce lien a expiré');
      expect(container.textContent).not.toContain('pas pu être vérifié');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'un motif inconnu (URL forgée) n’imprime rien plutôt que de recopier le paramètre',
    async () => {
      poserFragment('#error_code=<img src=x onerror=alert(1)>');
      const { container } = render(<LoginPage />);
      await waitFor(
        () => expect(container.textContent).toContain('Connexion à Savr'),
        ATTENTE_UI,
      );
      expect(container.textContent).not.toContain('onerror');
      expect(container.querySelector('img')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'les clés héritées d’Object ne rendent rien (la table est une Map, pas un objet)',
    async () => {
      // Piège déjà rencontré sur CETTE table en #401 : avec un objet littéral,
      // `T['toString']` rend une fonction et `T['__proto__']` un objet — React
      // reçoit alors autre chose que du texte et la page casse, par simple lien
      // forgé. Ces deux clés-là sont donc les sondes, pas une valeur inventée.
      for (const cle of ['toString', '__proto__', 'constructor', 'valueOf']) {
        poserFragment(`#error_code=${cle}`);
        const { container } = render(<LoginPage />);
        await waitFor(
          () => expect(container.textContent).toContain('Connexion à Savr'),
          ATTENTE_UI,
        );
        expect(container.textContent, cle).not.toContain('function');
        expect(container.textContent, cle).not.toContain('[object');
        cleanup();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'le motif en ?error= continue de fonctionner (non-régression #401)',
    async () => {
      params = new URLSearchParams({ error: 'verification_echouee' });
      const { container } = render(<LoginPage />);
      await waitFor(
        () =>
          expect(container.textContent).toContain(
            'Ce lien de vérification a expiré',
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});
