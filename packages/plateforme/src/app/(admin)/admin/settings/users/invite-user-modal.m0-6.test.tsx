/**
 * M0.6 — Modale d'invitation d'un membre (BL-P1-BOA-09, §06.06 §8).
 * Vérifie le provisioning direct (POST /api/v1/admin/users avec prénom/nom/
 * email/rôle/organisation) et le gating de l'option admin_savr selon le droit
 * réel (`canInviteAdmin`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { InviteUserModal } from './invite-user-modal';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}
let calls: FetchCall[] = [];

function mockFetch() {
  global.fetch = vi.fn(
    (url: string, init?: { method?: string; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined,
      });
      if (url.startsWith('/api/v1/admin/organisations')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              { id: 'org-9', raison_sociale: 'Kaspia SAS', type: 'traiteur' },
            ],
            limit: 50,
          }),
        }) as unknown as Promise<Response>;
      }
      // POST /api/v1/admin/users
      return Promise.resolve({
        ok: true,
        json: async () => ({ id: 'u-new' }),
      }) as unknown as Promise<Response>;
    },
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  mockFetch();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function pickOrg() {
  const search = screen.getByLabelText('Organisation');
  fireEvent.change(search, { target: { value: 'Kaspia' } });
  await waitFor(() => screen.getByText('Kaspia SAS'), ATTENTE_UI);
  fireEvent.click(screen.getByText('Kaspia SAS'));
}

describe('M0.6 — modale invitation', () => {
  it(
    'POST /api/v1/admin/users avec le payload provisioning',
    async () => {
      const onCreated = vi.fn();
      render(
        <InviteUserModal
          canInviteAdmin={true}
          onClose={() => {}}
          onCreated={onCreated}
        />,
      );

      fireEvent.change(screen.getByLabelText('Prénom'), {
        target: { value: 'Alice' },
      });
      fireEvent.change(screen.getByLabelText('Nom'), {
        target: { value: 'Martin' },
      });
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'alice@kaspia.fr' },
      });
      fireEvent.click(screen.getByRole('combobox', { name: 'Rôle' }));
      fireEvent.click(
        screen.getByRole('option', { name: 'Traiteur (manager)' }),
      );
      await pickOrg();

      fireEvent.click(screen.getByText('Inviter'));

      await waitFor(() => expect(onCreated).toHaveBeenCalled(), ATTENTE_UI);
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/api/v1/admin/users',
      );
      expect(post?.body).toMatchObject({
        prenom: 'Alice',
        nom: 'Martin',
        email: 'alice@kaspia.fr',
        role: 'traiteur_manager',
        organisation_id: 'org-9',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'la liste des organisations s’ouvre hors du corps défilant de la fenêtre',
    async () => {
      // Constaté en production le 2026-11-05 : dessinée dans la fenêtre, la
      // liste restait cachée sous son pied (corps en overflow-y-auto).
      render(
        <InviteUserModal
          canInviteAdmin={true}
          onClose={() => {}}
          onCreated={() => {}}
        />,
      );
      const fenetre = screen.getByRole('dialog', { name: 'Inviter un membre' });
      // La fenêtre prend le focus à l'ouverture (setTimeout 0) : l'attendre
      // avant de placer le focus dans le champ.
      await waitFor(() => expect(fenetre).toHaveFocus(), ATTENTE_UI);
      const champ = screen.getByLabelText('Organisation');
      champ.focus();
      fireEvent.change(champ, { target: { value: 'Kaspia' } });
      const choix = await screen.findByRole(
        'option',
        { name: 'Kaspia SAS' },
        ATTENTE_UI,
      );
      expect(fenetre).not.toContainElement(choix);
      // La liste ouverte, la saisie reste dans le champ.
      expect(champ).toHaveFocus();

      // Un clic dans le champ ne referme pas la liste ; un clic hors de la
      // liste, si.
      fireEvent.pointerDown(screen.getByLabelText('Organisation'));
      expect(screen.getByRole('option', { name: 'Kaspia SAS' })).toBeVisible();
      fireEvent.pointerDown(screen.getByLabelText('Prénom'));
      await waitFor(
        () =>
          expect(
            screen.queryByRole('option', { name: 'Kaspia SAS' }),
          ).not.toBeInTheDocument(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'organisation choisie au clavier : flèche bas puis Entrée',
    async () => {
      const onCreated = vi.fn();
      render(
        <InviteUserModal
          canInviteAdmin={true}
          onClose={() => {}}
          onCreated={onCreated}
        />,
      );
      fireEvent.change(screen.getByLabelText('Prénom'), {
        target: { value: 'Alice' },
      });
      fireEvent.change(screen.getByLabelText('Nom'), {
        target: { value: 'Martin' },
      });
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'alice@kaspia.fr' },
      });
      const champ = screen.getByLabelText('Organisation');
      fireEvent.change(champ, { target: { value: 'Kaspia' } });
      const choix = await screen.findByRole(
        'option',
        { name: 'Kaspia SAS' },
        ATTENTE_UI,
      );
      expect(choix).toHaveAttribute('aria-selected', 'false');

      fireEvent.keyDown(champ, { key: 'ArrowDown' });
      expect(choix).toHaveAttribute('aria-selected', 'true');
      expect(champ).toHaveAttribute('aria-activedescendant', choix.id);

      fireEvent.keyDown(champ, { key: 'Enter' });
      await waitFor(
        () =>
          expect(
            screen.getByRole('button', { name: 'Effacer la sélection' }),
          ).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(screen.getByText('Kaspia SAS')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Inviter'));
      await waitFor(() => expect(onCreated).toHaveBeenCalled(), ATTENTE_UI);
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/api/v1/admin/users',
      );
      expect(post?.body).toMatchObject({ organisation_id: 'org-9' });
    },
    ATTENTE_CAS_MS,
  );

  it('admin : l’option Admin Savr est proposée', () => {
    render(
      <InviteUserModal
        canInviteAdmin={true}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Rôle' }));
    expect(
      screen.getByRole('option', { name: 'Admin Savr' }),
    ).toBeInTheDocument();
  });

  it('ops : l’option Admin Savr est masquée', () => {
    render(
      <InviteUserModal
        canInviteAdmin={false}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Rôle' }));
    expect(
      screen.queryByRole('option', { name: 'Admin Savr' }),
    ).not.toBeInTheDocument();
    // Les autres rôles restent disponibles.
    expect(
      screen.getByRole('option', { name: 'Ops Savr' }),
    ).toBeInTheDocument();
  });

  it(
    'erreur serveur affichée, onCreated non appelé',
    async () => {
      global.fetch = vi.fn((url: string) => {
        if (url.startsWith('/api/v1/admin/organisations')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [{ id: 'org-9', raison_sociale: 'Kaspia SAS' }],
              limit: 50,
            }),
          }) as unknown as Promise<Response>;
        }
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: 'Email déjà utilisé' }),
        }) as unknown as Promise<Response>;
      }) as unknown as typeof fetch;

      const onCreated = vi.fn();
      render(
        <InviteUserModal
          canInviteAdmin={true}
          onClose={() => {}}
          onCreated={onCreated}
        />,
      );
      fireEvent.change(screen.getByLabelText('Prénom'), {
        target: { value: 'Bob' },
      });
      fireEvent.change(screen.getByLabelText('Nom'), {
        target: { value: 'X' },
      });
      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'bob@x.fr' },
      });
      await pickOrg();
      fireEvent.click(screen.getByText('Inviter'));

      await waitFor(
        () =>
          expect(screen.getByText('Email déjà utilisé')).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(onCreated).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );
});
