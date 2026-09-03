/**
 * M0.6 — Fiche organisation : « Ajouter un utilisateur » (BL-P1-BOA-09, §06.06 §8).
 * Variante scopée à l'organisation de la fiche : l'org n'est PAS choisie dans
 * l'UI (pas de sélecteur), elle est imposée par la prop `organisationId`. Les
 * rôles proposés dépendent du type d'organisation. Provisioning via le même
 * endpoint POST /api/v1/admin/users que la modale générique des Paramètres.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { ClientInviteUserModal, rolesForOrgType } from './invite-user-modal';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
let calls: FetchCall[] = [];

function mockFetch(ok: boolean, payload: unknown = { id: 'u-new' }) {
  global.fetch = vi.fn(
    (url: string, init?: { method?: string; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      return Promise.resolve({
        ok,
        json: async () => payload,
      }) as unknown as Promise<Response>;
    },
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.restoreAllMocks());

describe('M0.6 — fiche organisation : ajouter un utilisateur', () => {
  it('rolesForOrgType : rôles restreints au type d’organisation', () => {
    expect(rolesForOrgType('traiteur')).toEqual([
      'traiteur_manager',
      'traiteur_commercial',
    ]);
    expect(rolesForOrgType('agence')).toEqual(['agence']);
    expect(rolesForOrgType('gestionnaire_lieux')).toEqual([
      'gestionnaire_lieux',
    ]);
    expect(rolesForOrgType('client_organisateur')).toEqual([
      'client_organisateur',
    ]);
    // jamais de rôle interne Savr proposé pour une org cliente
    expect(rolesForOrgType('agence')).not.toContain('admin_savr');
    expect(rolesForOrgType('agence')).not.toContain('ops_savr');
  });

  it('POST /api/v1/admin/users avec organisation_id imposé (jamais choisi) + rôle', async () => {
    mockFetch(true);
    const onCreated = vi.fn();
    render(
      <ClientInviteUserModal
        organisationId="org-agence"
        orgType="agence"
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    // Aucun sélecteur d'organisation : l'org est imposée par la fiche.
    expect(screen.queryByLabelText('Organisation')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Prénom/), {
      target: { value: 'Adèle' },
    });
    fireEvent.change(screen.getByLabelText(/^Nom/), {
      target: { value: 'Arep' },
    });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'adele@arep.test' },
    });
    fireEvent.click(screen.getByText('Inviter'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = calls.find(
      (c) => c.method === 'POST' && c.url === '/api/v1/admin/users',
    );
    expect(post?.body).toMatchObject({
      prenom: 'Adèle',
      nom: 'Arep',
      email: 'adele@arep.test',
      role: 'agence', // rôle par défaut = 1er rôle du type d'org
      organisation_id: 'org-agence',
    });
  });

  it('type traiteur : deux rôles proposés, manager par défaut', async () => {
    mockFetch(true);
    render(
      <ClientInviteUserModal
        organisationId="org-tr"
        orgType="traiteur"
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    const select = screen.getByLabelText('Rôle') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['traiteur_manager', 'traiteur_commercial']);
    expect(select.value).toBe('traiteur_manager');
  });

  it('erreur serveur affichée, onCreated non appelé', async () => {
    mockFetch(false, { error: 'Email déjà utilisé' });
    const onCreated = vi.fn();
    render(
      <ClientInviteUserModal
        organisationId="org-agence"
        orgType="agence"
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Prénom/), {
      target: { value: 'X' },
    });
    fireEvent.change(screen.getByLabelText(/^Nom/), { target: { value: 'Y' } });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'x@y.test' },
    });
    fireEvent.click(screen.getByText('Inviter'));

    await waitFor(() =>
      expect(screen.getByText('Email déjà utilisé')).toBeInTheDocument(),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });
});
