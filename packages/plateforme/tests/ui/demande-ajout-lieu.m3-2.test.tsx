/**
 * @vitest-environment jsdom
 *
 * M3.2 — Bouton « Demander l'ajout d'un lieu » de la liste Lieux du
 * gestionnaire (§06.05 §3 « Ajout / retrait lieu », arbitrages Val 2026-10-07) :
 * présence du bouton, état « demande en cours », formulaire à trois champs,
 * envoi, refus.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/lieux',
}));

import GestionnaireLieuxPage from '@/app/(gestionnaire)/gestionnaire/lieux/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

const BOUTON = 'Demander l’ajout d’un lieu';
const ROUTE = '/api/v1/gestionnaire/lieux/demande-ajout';
const MENTION =
  'Une demande d’ajout est en cours de traitement par l’équipe Savr.';

const LIGNE = {
  id: '11111111-1111-4111-8111-111111111111',
  nom: 'CNIT Forest',
  adresse_acces: '2 Place de la Défense',
  code_postal: '92800',
  ville: 'Puteaux',
  type_vehicule_max: 'poids_lourd',
  capacite_maximum: 3500,
  actif: true,
  nb_collectes_12m: 0,
  tonnage_12m_kg: 0,
};

type Reponse = { status?: number; body: unknown };
let liste: Reponse;
// 'reseau' : fetch rejeté ; 'attente' : réponse retenue jusqu'à `liberer()`
// (envoi) ou `libererEtat()` (lecture d'état du montage).
let etat: Reponse | 'reseau' | 'attente';
let demande: Reponse | 'reseau' | 'attente';
let liberer: (rep: Reponse) => void = () => {};
let libererEtat: (rep: Reponse) => void = () => {};
const appels: { url: string; method: string; body: unknown }[] = [];

const reponse = (rep: Reponse) => {
  const status = rep.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(rep.body),
  } as Response;
};

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  appels.push({
    url,
    method,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  });
  if (url !== ROUTE) return Promise.resolve(reponse(liste));
  if (method === 'GET') {
    if (etat === 'reseau')
      return Promise.reject(new TypeError('Failed to fetch'));
    if (etat === 'attente')
      return new Promise<Response>((resolve) => {
        libererEtat = (rep) => resolve(reponse(rep));
      });
    return Promise.resolve(reponse(etat));
  }
  if (demande === 'reseau')
    return Promise.reject(new TypeError('Failed to fetch'));
  if (demande === 'attente')
    return new Promise<Response>((resolve) => {
      liberer = (rep) => resolve(reponse(rep));
    });
  return Promise.resolve(reponse(demande));
});

beforeEach(() => {
  cleanup();
  appels.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  liste = { body: { data: [LIGNE] } };
  etat = { body: { data: { en_cours: false } } };
  demande = { status: 201, body: { data: { demandee: true } } };
  window.history.replaceState(null, '', '/gestionnaire/lieux');
});

const envois = () => appels.filter((a) => a.method === 'POST');
const bouton = () => screen.getByRole('button', { name: BOUTON });

async function rendreListe() {
  renderAvecToasts(<GestionnaireLieuxPage />);
  await screen.findAllByText('CNIT Forest', undefined, ATTENTE_UI);
  // L'état de la demande est lu au montage, à côté de la liste.
  await waitFor(
    () =>
      expect(appels.some((a) => a.url === ROUTE && a.method === 'GET')).toBe(
        true,
      ),
    ATTENTE_UI,
  );
}

// Liste rendue, puis clic sur le bouton → le formulaire (dialogue).
async function ouvrirFormulaire() {
  await rendreListe();
  fireEvent.click(bouton());
  return within(
    await screen.findByRole('dialog', { name: BOUTON }, ATTENTE_UI),
  );
}

function saisir(
  f: ReturnType<typeof within>,
  valeurs: { nom?: string; adresse?: string; precision?: string },
) {
  if (valeurs.nom !== undefined)
    fireEvent.change(f.getByLabelText(/^Nom du lieu/), {
      target: { value: valeurs.nom },
    });
  if (valeurs.adresse !== undefined)
    fireEvent.change(f.getByLabelText(/^Adresse/), {
      target: { value: valeurs.adresse },
    });
  if (valeurs.precision !== undefined)
    fireEvent.change(f.getByLabelText(/^Précision/), {
      target: { value: valeurs.precision },
    });
}

const SAISIE = {
  nom: 'Pavillon Dauphine',
  adresse: 'Place du Maréchal de Lattre de Tassigny, 75116 Paris',
};

describe('M3.2 / liste Lieux — bouton « Demander l’ajout d’un lieu »', () => {
  it(
    'M3.2/demande_ajout_lieu_bouton_sur_la_liste — le bouton est proposé, liste remplie comme liste vide',
    async () => {
      await rendreListe();
      expect(bouton()).toBeEnabled();
      expect(screen.queryByText(MENTION)).toBeNull();
      // Aucun formulaire tant que le bouton n'est pas cliqué, aucune demande envoyée.
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(envois()).toHaveLength(0);

      // Un gestionnaire sans aucun lieu rattaché garde le moyen d'en demander un.
      cleanup();
      liste = { body: { data: [] } };
      renderAvecToasts(<GestionnaireLieuxPage />);
      await screen.findByText('Aucun lieu associé', undefined, ATTENTE_UI);
      expect(bouton()).toBeEnabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_bouton_neutralise_demande_en_cours — une demande ouverte : bouton neutralisé, mention affichée, aucun formulaire',
    async () => {
      etat = { body: { data: { en_cours: true } } };
      await rendreListe();
      expect(
        await screen.findByText(MENTION, undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(bouton()).toBeDisabled();
      // Le motif est relié au bouton pour un lecteur d'écran.
      expect(bouton()).toHaveAccessibleDescription(MENTION);
      fireEvent.click(bouton());
      expect(screen.queryByRole('dialog')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_etat_illisible_bouton_propose — état de la demande illisible : le bouton reste proposé, la liste s’affiche',
    async () => {
      // Réponse en erreur, puis service injoignable : même issue.
      for (const illisible of [
        { status: 500, body: { error: 'Erreur serveur' } },
        'reseau' as const,
      ]) {
        cleanup();
        appels.length = 0;
        etat = illisible;
        await rendreListe();
        expect(bouton()).toBeEnabled();
        expect(screen.queryByText(MENTION)).toBeNull();
        expect(
          screen.queryByText(/Impossible de charger vos lieux/),
        ).toBeNull();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_etat_tardif_ne_reactive_pas — la lecture d’état du montage, arrivée après un envoi, ne rend pas le bouton',
    async () => {
      etat = 'attente';
      const f = await ouvrirFormulaire();
      saisir(f, SAISIE);
      fireEvent.click(f.getByRole('button', { name: 'Envoyer la demande' }));
      await screen.findByText('Demande envoyée', undefined, ATTENTE_UI);
      expect(bouton()).toBeDisabled();

      // La lecture partie au montage répond enfin, avec l'état d'AVANT l'envoi.
      libererEtat({ body: { data: { en_cours: false } } });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(bouton()).toBeDisabled();
      expect(screen.getByText(MENTION)).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_formulaire_trois_champs — nom et adresse obligatoires, précision facultative, bornes de la route',
    async () => {
      const f = await ouvrirFormulaire();
      const nom = f.getByLabelText(/^Nom du lieu/);
      const adresse = f.getByLabelText(/^Adresse/);
      const precision = f.getByLabelText('Précision (facultatif)');
      expect(nom).toBeRequired();
      expect(adresse).toBeRequired();
      expect(precision).not.toBeRequired();
      expect(nom).toHaveAttribute('maxlength', '150');
      expect(adresse).toHaveAttribute('maxlength', '300');
      expect(precision).toHaveAttribute('maxlength', '1000');
      // Le formulaire dit qui traite la demande.
      expect(
        f.getByText(/rattachement d’un lieu à votre organisation est réalisé/),
      ).toBeTruthy();

      // « Annuler » referme sans rien envoyer.
      fireEvent.click(f.getByRole('button', { name: 'Annuler' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(envois()).toHaveLength(0);
      expect(bouton()).toBeEnabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_champs_obligatoires_bloquent_l_envoi — sans nom ou sans adresse, rien ne part',
    async () => {
      const f = await ouvrirFormulaire();
      const envoyer = f.getByRole('button', { name: 'Envoyer la demande' });
      fireEvent.click(envoyer);
      saisir(f, { nom: SAISIE.nom });
      fireEvent.click(envoyer);
      saisir(f, { nom: '', adresse: SAISIE.adresse });
      fireEvent.click(envoyer);
      expect(envois()).toHaveLength(0);
      expect(screen.getByRole('dialog', { name: BOUTON })).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_envoi_confirme — les trois champs partent à la route, un toast confirme, le bouton se neutralise',
    async () => {
      const f = await ouvrirFormulaire();
      saisir(f, { ...SAISIE, precision: 'Premier événement prévu en mars.' });
      fireEvent.click(f.getByRole('button', { name: 'Envoyer la demande' }));

      expect(
        await screen.findByText('Demande envoyée', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(
        screen.getByText('L’équipe Savr a bien reçu votre demande.'),
      ).toBeTruthy();
      expect(envois()).toEqual([
        {
          url: ROUTE,
          method: 'POST',
          body: { ...SAISIE, precision: 'Premier événement prévu en mars.' },
        },
      ]);
      // Formulaire refermé ; une demande est désormais en cours.
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(bouton()).toBeDisabled();
      expect(screen.getByText(MENTION)).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_deja_en_cours_409 — demande déjà ouverte par ailleurs : information, formulaire refermé, bouton neutralisé',
    async () => {
      demande = {
        status: 409,
        body: {
          error:
            'Une demande d’ajout est déjà en cours de traitement par l’équipe Savr.',
        },
      };
      const f = await ouvrirFormulaire();
      saisir(f, SAISIE);
      fireEvent.click(f.getByRole('button', { name: 'Envoyer la demande' }));

      expect(
        await screen.findByText('Demande déjà en cours', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByText('Demande envoyée')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(bouton()).toBeDisabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_refus_affiche — saisie refusée : le motif s’affiche et la saisie est conservée ; panne : message neutre, jamais le message technique',
    async () => {
      demande = {
        status: 422,
        body: {
          error: 'Le nom du lieu contient des caractères non autorisés.',
        },
      };
      const f = await ouvrirFormulaire();
      saisir(f, SAISIE);
      fireEvent.click(f.getByRole('button', { name: 'Envoyer la demande' }));

      const alerte = await f.findByRole('alert', undefined, ATTENTE_UI);
      expect(alerte).toHaveTextContent(
        'Le nom du lieu contient des caractères non autorisés.',
      );
      expect(f.getByLabelText(/^Nom du lieu/)).toHaveValue(SAISIE.nom);
      expect(f.getByLabelText(/^Adresse/)).toHaveValue(SAISIE.adresse);
      expect(screen.queryByText('Demande envoyée')).toBeNull();
      expect(bouton()).toBeEnabled();

      // Corps réels de la route en cas de panne ou de session expirée.
      for (const rep of [
        { status: 500, body: { error: 'Erreur serveur' } },
        { status: 401, body: { error: 'Non autorisé' } },
      ]) {
        demande = rep;
        fireEvent.click(f.getByRole('button', { name: 'Envoyer la demande' }));
        await waitFor(
          () =>
            expect(f.getByRole('alert')).toHaveTextContent(
              'La demande n’a pas pu être envoyée. Réessayez.',
            ),
          ATTENTE_UI,
        );
        expect(f.queryByText(rep.body.error)).toBeNull();
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_erreur_reseau — service injoignable : message dédié, formulaire toujours ouvert',
    async () => {
      demande = 'reseau';
      const f = await ouvrirFormulaire();
      saisir(f, SAISIE);
      fireEvent.click(f.getByRole('button', { name: 'Envoyer la demande' }));
      expect(
        await f.findByText(
          'La demande n’a pas pu être envoyée. Vérifiez votre connexion puis réessayez.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(
        f.getByRole('button', { name: 'Envoyer la demande' }),
      ).toBeEnabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/demande_ajout_lieu_envoi_en_cours_verrouille — pendant l’envoi : un seul envoi, ni « Annuler » ni Échap ne referment le formulaire',
    async () => {
      demande = 'attente';
      const f = await ouvrirFormulaire();
      saisir(f, SAISIE);
      fireEvent.click(f.getByRole('button', { name: 'Envoyer la demande' }));

      const envoi = await f.findByRole(
        'button',
        { name: 'Envoi…' },
        ATTENTE_UI,
      );
      expect(envoi).toBeDisabled();
      expect(f.getByRole('button', { name: 'Annuler' })).toBeDisabled();
      // Second clic, Échap : sans effet tant que la réponse n'est pas arrivée.
      fireEvent.click(envoi);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByRole('dialog', { name: BOUTON })).toBeTruthy();
      expect(envois()).toHaveLength(1);

      liberer({ status: 201, body: { data: { demandee: true } } });
      expect(
        await screen.findByText('Demande envoyée', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
