/**
 * M0.6 — Modale d'invitation d'un membre (BL-P1-BOA-09, §06.06 §8).
 * Vérifie le provisioning direct (POST /api/v1/admin/users avec prénom/nom/
 * email/rôle/organisation) et le gating de l'option admin_savr selon le droit
 * réel (`canInviteAdmin`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { InviteUserModal } from './invite-user-modal';

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
  await waitFor(() => screen.getByText('Kaspia SAS'));
  fireEvent.click(screen.getByText('Kaspia SAS'));
}

describe('M0.6 — modale invitation', () => {
  it('POST /api/v1/admin/users avec le payload provisioning', async () => {
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
    fireEvent.change(screen.getByLabelText('Rôle'), {
      target: { value: 'traiteur_manager' },
    });
    await pickOrg();

    fireEvent.click(screen.getByText('Inviter'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
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
  });

  it('admin : l’option Admin Savr est proposée', () => {
    render(
      <InviteUserModal
        canInviteAdmin={true}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
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
    expect(
      screen.queryByRole('option', { name: 'Admin Savr' }),
    ).not.toBeInTheDocument();
    // Les autres rôles restent disponibles.
    expect(
      screen.getByRole('option', { name: 'Ops Savr' }),
    ).toBeInTheDocument();
  });

  it('erreur serveur affichée, onCreated non appelé', async () => {
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
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'bob@x.fr' },
    });
    await pickOrg();
    fireEvent.click(screen.getByText('Inviter'));

    await waitFor(() =>
      expect(screen.getByText('Email déjà utilisé')).toBeInTheDocument(),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });
});
