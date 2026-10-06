/**
 * R-UI-5 G5 — invitation d'un utilisateur : un seul composant (forme modale
 * Admin + forme carte des espaces clients). Les 4 écrans gardent leurs tests
 * d'intégration (settings/users, clients/[id], mon-organisation traiteur et
 * gestionnaire) ; ici, ce que le composant commun garantit lui-même.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import {
  InviterUtilisateurCarte,
  InviterUtilisateurModal,
} from './inviter-utilisateur-modal';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function remplir() {
  fireEvent.change(screen.getByLabelText(/Prénom/), {
    target: { value: 'Léa' },
  });
  fireEvent.change(screen.getByLabelText(/^Nom/), {
    target: { value: 'Martin' },
  });
  fireEvent.change(screen.getByLabelText(/Email/), {
    target: { value: 'lea@x.test' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('R-UI-5 G5 — InviterUtilisateurModal', () => {
  it(
    'organisation à choisir : sans sélection, message et aucun POST',
    async () => {
      const fetchMock = vi.fn(() => Promise.resolve(reponse(201, {})));
      vi.stubGlobal('fetch', fetchMock);
      const onCreated = vi.fn();
      render(
        <InviterUtilisateurModal
          titre="Inviter un membre"
          roles={['ops_savr']}
          roleInitial="ops_savr"
          rechercherOrganisations={async () => []}
          idPrefix="invite-membre"
          formId="invite-membre-form"
          onClose={() => {}}
          onCreated={onCreated}
        />,
      );
      expect(screen.getByLabelText('Organisation')).toBeInTheDocument();
      remplir();
      fireEvent.click(screen.getByRole('button', { name: 'Inviter' }));
      await screen.findByText(
        'Sélectionnez une organisation.',
        undefined,
        ATTENTE_UI,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onCreated).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'organisation imposée : ids préfixés, pas de sélecteur, erreur par défaut si réponse non JSON',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('oops', { status: 500 }))),
      );
      render(
        <InviterUtilisateurModal
          titre="Ajouter un utilisateur"
          roles={['agence']}
          roleInitial="agence"
          organisationId="org-1"
          idPrefix="invite"
          formId="invite-user-form"
          onClose={() => {}}
          onCreated={() => {}}
        />,
      );
      expect(screen.queryByLabelText('Organisation')).toBeNull();
      expect(document.getElementById('invite-prenom')).not.toBeNull();
      expect(document.getElementById('invite-role')).not.toBeNull();
      remplir();
      fireEvent.click(screen.getByRole('button', { name: 'Inviter' }));
      await screen.findByText(
        "Erreur lors de l'invitation",
        undefined,
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});

describe('R-UI-5 G5 — InviterUtilisateurCarte', () => {
  it(
    'corps envoyé tel que construit par l’écran, Toast, champs vidés, liste rechargée',
    async () => {
      const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
        Promise.resolve(reponse(201, { data: { id: 'u2' } })),
      );
      vi.stubGlobal('fetch', fetchMock);
      const onInvited = vi.fn();
      renderAvecToasts(
        <InviterUtilisateurCarte
          titre="Inviter un membre"
          endpoint="/api/v1/gestionnaire/mon-organisation/users"
          corps={({ prenom, nom, email }) => ({
            email,
            prenom,
            nom,
            role: 'gestionnaire_lieux',
          })}
          erreurParDefaut="Erreur lors de l'invitation."
          libelleBouton="Envoyer l'invitation"
          autoComplete
          onInvited={onInvited}
        />,
      );
      expect(screen.getByLabelText(/Prénom/)).toHaveAttribute(
        'autocomplete',
        'given-name',
      );
      remplir();
      fireEvent.click(
        screen.getByRole('button', { name: "Envoyer l'invitation" }),
      );
      await screen.findByText('Invitation envoyée.', undefined, ATTENTE_UI);
      await waitFor(() => expect(onInvited).toHaveBeenCalled(), ATTENTE_UI);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('/api/v1/gestionnaire/mon-organisation/users');
      expect(init?.body).toBe(
        JSON.stringify({
          email: 'lea@x.test',
          prenom: 'Léa',
          nom: 'Martin',
          role: 'gestionnaire_lieux',
        }),
      );
      expect(screen.getByLabelText(/Prénom/)).toHaveValue('');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'erreur : bandeau inline role=alert, ni Toast ni rechargement',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(reponse(409, { error: 'Email déjà utilisé.' })),
        ),
      );
      const onInvited = vi.fn();
      renderAvecToasts(
        <InviterUtilisateurCarte
          titre="Inviter un collaborateur"
          endpoint="/api/v1/traiteur/equipe/invitation"
          erreurParDefaut="Erreur."
          libelleBouton="Envoyer l’invitation"
          aide={<p>Le collaborateur est ajouté avec le rôle Commercial.</p>}
          onInvited={onInvited}
        />,
      );
      expect(
        screen.getByText(
          'Le collaborateur est ajouté avec le rôle Commercial.',
        ),
      ).toBeInTheDocument();
      remplir();
      fireEvent.click(
        screen.getByRole('button', { name: 'Envoyer l’invitation' }),
      );
      const alerte = await screen.findByRole('alert', {}, ATTENTE_UI);
      expect(alerte).toHaveTextContent('Email déjà utilisé.');
      expect(screen.queryByText('Invitation envoyée.')).toBeNull();
      expect(onInvited).not.toHaveBeenCalled();
      // Valeurs conservées pour corriger la saisie.
      expect(screen.getByLabelText(/Prénom/)).toHaveValue('Léa');
    },
    ATTENTE_CAS_MS,
  );
});
