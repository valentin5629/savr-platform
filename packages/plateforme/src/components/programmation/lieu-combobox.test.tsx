/**
 * Sélecteur de lieux du formulaire de programmation : une réponse en erreur de
 * GET /api/v1/programmation/lieux (corps `{ error }`) ne doit pas faire planter
 * la page. Constaté le 2026-11-19 : les colonnes des adresses de livraison
 * absentes de la base faisaient répondre la route en 500, le sélecteur rendait
 * l'objet d'erreur comme une liste et le formulaire tombait sur la page
 * d'erreur.
 */
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LieuCombobox } from './lieu-combobox';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';

afterEach(() => vi.unstubAllGlobals());

function ouvrir() {
  render(
    <LieuCombobox value={null} onChange={() => {}} onAddManuel={() => {}} />,
  );
  fireEvent.click(screen.getByText('Rechercher un lieu…'));
}

describe('M1.2 / Sélecteur de lieux : réponse en erreur', () => {
  it(
    'une erreur 500 de la route affiche « Aucun lieu trouvé » sans planter',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          json: async () => ({ error: 'Erreur serveur' }),
        })),
      );
      ouvrir();
      await waitFor(
        () => expect(screen.getByText('Aucun lieu trouvé')).toBeTruthy(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'une réponse illisible (réseau coupé) donne aussi une liste vide',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      );
      ouvrir();
      await waitFor(
        () => expect(screen.getByText('Aucun lieu trouvé')).toBeTruthy(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'une liste valide est affichée',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          json: async () => [
            {
              id: 'l1',
              nom: 'Carrousel du Louvre',
              adresse_acces: '99 rue de Rivoli',
              code_postal: '75001',
              ville: 'Paris',
              controle_acces_requis_default: false,
            },
          ],
        })),
      );
      ouvrir();
      await waitFor(
        () => expect(screen.getByText('Carrousel du Louvre')).toBeTruthy(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});
