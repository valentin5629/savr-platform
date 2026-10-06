/**
 * R-UI-1 H1 (clôt D1 de la PR #473) — Mon organisation > Équipe : les succès
 * éphémères (invitation envoyée, collectes transférées) sont des Toasts 4 s,
 * plus un bandeau vert dans le formulaire ; les erreurs restent inline
 * (`AlertBar err`, role=alert).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { MonOrganisationClient } from './mon-organisation-client';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { messageDeRole } from '@/test-utils/message-role';
import { renderAvecToasts } from '@/test-utils/toasts';

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ouvrirEquipe() {
  renderAvecToasts(<MonOrganisationClient isManager userId="u1" />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Équipe' }));
  return screen.findByText('Inviter un collaborateur', undefined, ATTENTE_UI);
}

function remplirInvitation() {
  fireEvent.change(screen.getByLabelText(/Prénom/), {
    target: { value: 'Léa' },
  });
  fireEvent.change(screen.getByLabelText(/^Nom/), {
    target: { value: 'Martin' },
  });
  fireEvent.change(screen.getByLabelText(/Email/), {
    target: { value: 'lea@traiteur.test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation' }));
}

describe('R-UI-1 — Mon organisation traiteur : feedback Équipe', () => {
  it(
    'invitation réussie → Toast, hors du formulaire',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === 'POST'
              ? reponse(201, { data: { id: 'u2' } })
              : reponse(200, { data: [] }),
          ),
        ),
      );
      await ouvrirEquipe();
      remplirInvitation();
      const toast = await screen.findByText(
        'Invitation envoyée.',
        undefined,
        ATTENTE_UI,
      );
      expect(toast.closest('form')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'invitation refusée → bandeau d’erreur inline, pas de toast',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === 'POST'
              ? reponse(409, { error: 'Email déjà utilisé.' })
              : reponse(200, { data: [] }),
          ),
        ),
      );
      await ouvrirEquipe();
      remplirInvitation();
      const erreur = await messageDeRole('alert', 'Email déjà utilisé.');
      expect(erreur.closest('form')).not.toBeNull();
      expect(screen.queryByText('Invitation envoyée.')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'transfert sans collaborateurs choisis → erreur inline',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: [] }))),
      );
      await ouvrirEquipe();
      fireEvent.click(screen.getByRole('button', { name: 'Transférer' }));
      const erreur = await messageDeRole(
        'alert',
        'Choisissez le collaborateur de départ et celui d’arrivée.',
      );
      expect(erreur.closest('form')).not.toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
