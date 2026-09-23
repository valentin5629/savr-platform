/**
 * Écran d'inscription en libre-service — /signup.
 *
 * Jusqu'ici `POST /api/auth/signup` était complète et n'était appelée par
 * personne : l'URL `/signup`, pourtant déclarée publique dans le middleware,
 * rendait un 404. Personne ne pouvait créer de compte.
 *
 * Ce que ces tests garantissent : les 3 étapes ne laissent pas passer une saisie
 * que la route refuserait (chaque champ et son refus), la case CGU est
 * réellement bloquante, la politique de mot de passe est appliquée AVANT tout
 * appel réseau — une tentative refusée localement ne doit pas consommer une des
 * 5 tentatives horaires par adresse IP —, et les trois refus du serveur
 * (422 / 429 / 409) arrivent sous les yeux de l'utilisateur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import SignupPage from '@/app/signup/page.js';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ success: true, organisation_id: 'org-1' }),
  });
});

afterEach(cleanup);

const IDENTITE_OK = {
  '#prenom': 'Marie',
  '#nom': 'Durand',
  '#email': 'marie@traiteur.fr',
  '#telephone': '0123456789',
  '#raison-sociale': 'Traiteur Durand SAS',
};

function remplir(c: HTMLElement, selecteur: string, valeur: string) {
  fireEvent.change(c.querySelector(selecteur)!, { target: { value: valeur } });
}

function soumettre(c: HTMLElement) {
  fireEvent.submit(c.querySelector('form')!);
}

/** Étape 1 → 2 : choisit un profil et valide. */
function choisirProfil(c: HTMLElement, valeur = 'traiteur') {
  fireEvent.click(c.querySelector(`input[value="${valeur}"]`)!);
  soumettre(c);
}

/** Étape 2 → 3 : remplit l'identité (surchargeable) et valide. */
function remplirIdentite(c: HTMLElement, patch: Record<string, string> = {}) {
  for (const [sel, val] of Object.entries({ ...IDENTITE_OK, ...patch })) {
    remplir(c, sel, val);
  }
  soumettre(c);
}

/** Étape 3 : mot de passe + confirmation + case CGU. */
function remplirMotDePasse(
  c: HTMLElement,
  mdp = 'SavrTest2026!',
  confirmation = mdp,
  cocherCgu = true,
) {
  remplir(c, '#mot-de-passe', mdp);
  remplir(c, '#confirmation', confirmation);
  if (cocherCgu) fireEvent.click(c.querySelector('#cgu')!);
}

/** Amène l'écran à l'étape 3, prêt à soumettre. */
function allerEtape3(c: HTMLElement) {
  choisirProfil(c);
  remplirIdentite(c);
}

describe('M0.4 — /signup : parcours complet (CDC §05 §8 étape 1)', () => {
  it(
    'envoie à la route les 7 champs du CDC, avec le type de profil choisi',
    async () => {
      const { container } = render(<SignupPage />);
      choisirProfil(container, 'gestionnaire_lieux');
      remplirIdentite(container);
      remplirMotDePasse(container);
      soumettre(container);

      await waitFor(
        () => expect(fetchMock).toHaveBeenCalledTimes(1),
        ATTENTE_UI,
      );
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/auth/signup');
      expect(JSON.parse(String(init.body))).toEqual({
        email: 'marie@traiteur.fr',
        mot_de_passe: 'SavrTest2026!',
        prenom: 'Marie',
        nom: 'Durand',
        telephone: '0123456789',
        type_profil: 'gestionnaire_lieux',
        raison_sociale: 'Traiteur Durand SAS',
        acceptation_cgu: true,
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    "après création, l'écran renvoie vers la boîte mail et n'annonce aucune connexion",
    async () => {
      const { container } = render(<SignupPage />);
      allerEtape3(container);
      remplirMotDePasse(container);
      soumettre(container);

      await waitFor(
        () =>
          expect(container.textContent).toContain('Vérifiez votre boîte mail'),
        ATTENTE_UI,
      );
      expect(container.textContent).toContain('marie@traiteur.fr');
      expect(container.querySelector('#mot-de-passe')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ne propose que les 3 types de profil acceptés par la route',
    () => {
      const { container } = render(<SignupPage />);
      const valeurs = [
        ...container.querySelectorAll('input[name="type_profil"]'),
      ].map((n) => (n as HTMLInputElement).value);
      expect(valeurs).toEqual(['traiteur', 'agence', 'gestionnaire_lieux']);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ne demande aucun SIRET (décision Val 2026-09-23 : étape 2 du CDC)',
    () => {
      const { container } = render(<SignupPage />);
      expect(container.textContent).not.toContain('SIRET');
      choisirProfil(container);
      expect(container.querySelector('#siret')).toBeNull();
      expect(container.textContent).not.toContain('SIRET');
      remplirIdentite(container);
      expect(container.querySelector('#siret')).toBeNull();
      expect(container.textContent).not.toContain('SIRET');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M0.4 — /signup : chaque champ et son refus (CDC §05 §8)', () => {
  it(
    'aucun profil choisi → refus, on reste à l’étape 1',
    () => {
      const { container } = render(<SignupPage />);
      soumettre(container);
      expect(container.textContent).toContain('Choisissez le profil');
      expect(container.querySelector('#prenom')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  const refus: Array<[string, Record<string, string>, string]> = [
    ['prénom à 1 caractère', { '#prenom': 'M' }, 'caractères minimum'],
    ['nom à 1 caractère', { '#nom': 'D' }, 'caractères minimum'],
    ['email sans domaine', { '#email': 'marie@localhost' }, 'email valide'],
    ['email sans arobase', { '#email': 'marie.traiteur.fr' }, 'email valide'],
    ['téléphone trop court', { '#telephone': '01020304' }, 'téléphone'],
    ['téléphone étranger', { '#telephone': '+4915112345678' }, 'téléphone'],
    ['raison sociale vide', { '#raison-sociale': '   ' }, 'raison sociale'],
  ];

  for (const [libelle, patch, attendu] of refus) {
    it(
      `${libelle} → refus à l'étape 2, sans appel réseau`,
      () => {
        const { container } = render(<SignupPage />);
        choisirProfil(container);
        remplirIdentite(container, patch);

        expect(container.textContent).toContain(attendu);
        // On n'a pas avancé : le champ mot de passe n'existe pas encore.
        expect(container.querySelector('#mot-de-passe')).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      },
      ATTENTE_CAS_MS,
    );
  }
});

describe('M0.4 — /signup : mot de passe et CGU refusés AVANT le réseau', () => {
  // Message EXACT attendu, pas un fragment : l'étape 3 affiche déjà « mot de
  // passe » dans son label et dans sa consigne, donc un toContain('mot de passe')
  // serait vert même si aucune erreur ne s'affichait.
  const faibles: Array<[string, string, string]> = [
    ['trop court', 'Savr26!', 'au moins 10 caractères.'],
    ['sans majuscule', 'savrtest2026!', 'au moins une majuscule.'],
    ['sans chiffre', 'SavrTestTest!', 'au moins un chiffre.'],
    [
      'sans caractère spécial',
      'SavrTest2026',
      'au moins un caractère spécial.',
    ],
  ];

  for (const [libelle, mdp, message] of faibles) {
    it(
      `mot de passe ${libelle} → refusé sans appeler la route`,
      () => {
        const { container } = render(<SignupPage />);
        allerEtape3(container);
        remplirMotDePasse(container, mdp);
        soumettre(container);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(container.textContent).toContain(message);
      },
      ATTENTE_CAS_MS,
    );
  }

  it(
    'confirmation différente → refusée sans appeler la route',
    () => {
      const { container } = render(<SignupPage />);
      allerEtape3(container);
      remplirMotDePasse(container, 'SavrTest2026!', 'SavrTest2026?');
      soumettre(container);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(container.textContent).toContain('ne correspondent pas');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'CGU non cochées → création refusée, la route n’est jamais appelée',
    () => {
      const { container } = render(<SignupPage />);
      allerEtape3(container);
      remplirMotDePasse(container, 'SavrTest2026!', 'SavrTest2026!', false);
      soumettre(container);

      expect(fetchMock).not.toHaveBeenCalled();
      // Le libellé du lien contient déjà « Conditions Générales d'Utilisation » :
      // on exige la PHRASE de refus, sinon l'assertion serait vraie sans erreur.
      expect(container.textContent).toContain(
        "Vous devez accepter les Conditions Générales d'Utilisation pour créer un compte.",
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'la case CGU pointe vers le texte publié (/cgu), pas vers un lien mort',
    () => {
      const { container } = render(<SignupPage />);
      allerEtape3(container);
      const lien = container.querySelector('a[href="/cgu"]');
      expect(lien).not.toBeNull();
      expect(lien!.textContent).toContain('Conditions Générales');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M0.4 — /signup : les refus du serveur sont rendus lisibles', () => {
  async function soumettreAvecReponse(res: {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }) {
    fetchMock.mockResolvedValue(res);
    const { container } = render(<SignupPage />);
    allerEtape3(container);
    remplirMotDePasse(container);
    soumettre(container);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), ATTENTE_UI);
    return container;
  }

  it(
    '422 — le motif exact de la route est affiché (email jetable)',
    async () => {
      const c = await soumettreAvecReponse({
        ok: false,
        status: 422,
        json: async () => ({ error: 'Adresse email jetable non autorisée' }),
      });
      await waitFor(
        () =>
          expect(c.textContent).toContain(
            'Adresse email jetable non autorisée',
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    '409 — le doublon de SIRET/domaine est affiché tel que la route le formule',
    async () => {
      const c = await soumettreAvecReponse({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'Ce domaine email est déjà rattaché à une organisation.',
        }),
      });
      await waitFor(
        () =>
          expect(c.textContent).toContain(
            'Ce domaine email est déjà rattaché à une organisation.',
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    '429 — l’écran dit combien de temps attendre, là où la route reste muette',
    async () => {
      const c = await soumettreAvecReponse({
        ok: false,
        status: 429,
        json: async () => ({
          error: 'Trop de tentatives. Réessayez plus tard.',
        }),
      });
      await waitFor(
        () => expect(c.textContent).toContain('Trop de tentatives'),
        ATTENTE_UI,
      );
      expect(c.textContent).toContain('une heure');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'réseau coupé → message explicite, pas d’écran de succès',
    async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      const { container } = render(<SignupPage />);
      allerEtape3(container);
      remplirMotDePasse(container);
      soumettre(container);

      await waitFor(
        () =>
          expect(container.textContent).toContain('Vérifiez votre connexion'),
        ATTENTE_UI,
      );
      expect(container.textContent).not.toContain('Vérifiez votre boîte mail');
    },
    ATTENTE_CAS_MS,
  );
});
