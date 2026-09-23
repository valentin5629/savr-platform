/**
 * Parcours « mot de passe oublié » — écrans.
 *
 * Jusqu'ici l'API existait sans aucune page : `/reset-password` et
 * `/reset-password/confirm` étaient déclarés publics dans le middleware et
 * répondaient 404. Un utilisateur qui perdait son mot de passe recevait donc un
 * email dont le lien tombait sur une page d'erreur — aucune sortie.
 *
 * Ce que ces tests garantissent : le formulaire appelle bien l'API, la
 * confirmation ne dit JAMAIS si l'adresse est connue (pas d'énumération de
 * comptes), la politique de mot de passe est refusée AVANT tout appel réseau, et
 * un lien périmé donne un écran qui explique et propose une sortie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const push = vi.fn();
let params = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => params,
}));

import ResetPasswordPage from '@/app/reset-password/page.js';
import ResetPasswordConfirmPage from '@/app/reset-password/confirm/page.js';
import LoginPage from '@/app/login/page.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  params = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  });
});

afterEach(cleanup);

function remplir(container: HTMLElement, selecteur: string, valeur: string) {
  fireEvent.change(container.querySelector(selecteur)!, {
    target: { value: valeur },
  });
}

describe('/reset-password — demande du lien', () => {
  it(
    "envoie l'adresse saisie à l'API de réinitialisation",
    async () => {
      const { container } = render(<ResetPasswordPage />);
      remplir(container, 'input[type="email"]', 'marie@traiteur.fr');
      fireEvent.submit(container.querySelector('form')!);

      await waitFor(
        () => expect(fetchMock).toHaveBeenCalledTimes(1),
        ATTENTE_UI,
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/auth/reset-password');
      expect(JSON.parse(String(init.body))).toEqual({
        email: 'marie@traiteur.fr',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    "la confirmation ne révèle jamais si l'adresse a un compte",
    async () => {
      const { container, findByText } = render(<ResetPasswordPage />);
      // Adresse volontairement neutre : un libellé du test ne doit pas pouvoir
      // se confondre avec le texte cherché dans l'écran.
      remplir(container, 'input[type="email"]', 'personne@example.com');
      fireEvent.submit(container.querySelector('form')!);

      // Le serveur répond 200 même pour une adresse inconnue (anti-énumération) :
      // l'écran doit tenir le même discours, au conditionnel.
      await findByText(/Si un compte Savr existe/, undefined, ATTENTE_UI);
      expect(container.textContent).not.toMatch(/compte introuvable|inconnu/i);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'un lien périmé renvoyé ici affiche le motif et la marche à suivre',
    async () => {
      params = new URLSearchParams({ error: 'lien_invalide' });
      const { findByText } = render(<ResetPasswordPage />);
      await findByText(/n'est plus valable/, undefined, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});

describe('/reset-password/confirm — nouveau mot de passe', () => {
  it(
    'un mot de passe hors politique est refusé AVANT tout appel réseau',
    async () => {
      const { container, findByText } = render(<ResetPasswordConfirmPage />);
      remplir(container, '#mot-de-passe', 'trop court');
      remplir(container, '#confirmation', 'trop court');
      fireEvent.submit(container.querySelector('form')!);

      await findByText(/au moins une majuscule/, undefined, ATTENTE_UI);
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux saisies différentes sont refusées sans appel réseau',
    async () => {
      const { container, findByText } = render(<ResetPasswordConfirmPage />);
      remplir(container, '#mot-de-passe', 'SavrTest2026!');
      remplir(container, '#confirmation', 'SavrTest2026?');
      fireEvent.submit(container.querySelector('form')!);

      await findByText(/ne sont pas identiques/, undefined, ATTENTE_UI);
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'mot de passe conforme → enregistré, puis écran de confirmation',
    async () => {
      const { container, findByText } = render(<ResetPasswordConfirmPage />);
      remplir(container, '#mot-de-passe', 'SavrTest2026!');
      remplir(container, '#confirmation', 'SavrTest2026!');
      fireEvent.submit(container.querySelector('form')!);

      await findByText('Mot de passe modifié', undefined, ATTENTE_UI);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/auth/update-password');
      expect(JSON.parse(String(init.body))).toEqual({
        mot_de_passe: 'SavrTest2026!',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    "session de récupération absente (401) → écran « lien expiré » avec une sortie, pas un message d'erreur brut",
    async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Session de récupération requise' }),
      });
      const { container, findByText } = render(<ResetPasswordConfirmPage />);
      remplir(container, '#mot-de-passe', 'SavrTest2026!');
      remplir(container, '#confirmation', 'SavrTest2026!');
      fireEvent.submit(container.querySelector('form')!);

      await findByText('Lien expiré', undefined, ATTENTE_UI);
      // La sortie est le cœur du cas : sans elle, l'utilisateur est coincé.
      const lien = container.querySelector('a[href="/reset-password"]');
      expect(lien).not.toBeNull();
      // Le jargon serveur ne remonte pas tel quel à l'écran.
      expect(container.textContent).not.toMatch(/Session de récupération/);
    },
    ATTENTE_CAS_MS,
  );
});

describe('/login — porte d’entrée du parcours', () => {
  it(
    'propose « Mot de passe oublié ? » vers la demande de lien',
    async () => {
      const { container, findByText } = render(<LoginPage />);
      await findByText('Mot de passe oublié ?', undefined, ATTENTE_UI);
      expect(
        container.querySelector('a[href="/reset-password"]'),
      ).not.toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    "affiche le motif d'un lien de vérification qui n'a pas abouti",
    async () => {
      params = new URLSearchParams({ error: 'verification_echouee' });
      const { findByText } = render(<LoginPage />);
      await findByText(/lien de vérification a expiré/, undefined, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    "un motif inconnu (URL forgée) n'imprime rien à l'écran",
    async () => {
      params = new URLSearchParams({ error: '<img src=x onerror=alert(1)>' });
      const { container, findByText } = render(<LoginPage />);
      await findByText('Connexion Savr', undefined, ATTENTE_UI);
      expect(container.textContent).not.toMatch(/onerror|img src/);
    },
    ATTENTE_CAS_MS,
  );

  // Un motif inventé (« zz », une balise) ne sonde RIEN : il n'est clé de rien.
  // Les seules valeurs dangereuses sont celles qu'un objet littéral rend sans
  // qu'on les ait posées — `__proto__` rend un objet (React refuse de le rendre
  // et la page de connexion plante), `toString` rend une fonction. C'est par là
  // qu'un lien forgé cassait l'écran ; le test doit donc viser ces clés-là.
  it.each([
    '__proto__',
    'toString',
    'constructor',
    'valueOf',
    'hasOwnProperty',
  ])(
    'un motif hérité d’Object.prototype (%s) ne casse pas la page et n’imprime rien',
    async (cle) => {
      params = new URLSearchParams({ error: cle });
      const { container, findByText } = render(<LoginPage />);
      await findByText('Connexion Savr', undefined, ATTENTE_UI);
      expect(container.querySelector('form')).not.toBeNull();
      expect(container.textContent).not.toMatch(/function|\[object/i);
    },
    ATTENTE_CAS_MS,
  );
});
