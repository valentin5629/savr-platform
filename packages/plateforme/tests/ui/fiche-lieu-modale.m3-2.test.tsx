/**
 * @vitest-environment jsdom
 *
 * M3.2 — Fiche lieu du gestionnaire en pop-up sur la liste Lieux (§06.05 §3,
 * arbitrage Val 2026-10-06) : ouverture, adresse, onglets, lecture seule et
 * bouton « Demande de modification d'information ».
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

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/lieux',
  redirect: (url: string) => redirect(url),
}));

import GestionnaireLieuxPage from '@/app/(gestionnaire)/gestionnaire/lieux/page.js';
import FicheLieuGestionnaireRedirect from '@/app/(gestionnaire)/gestionnaire/lieux/[id]/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';
import { periodeDerniers } from '@/lib/periodes-raccourcis';

const LIEU = '11111111-1111-4111-8111-111111111111';
const LISTE = '/gestionnaire/lieux';
const BOUTON = 'Demande de modification d’information';

const LIGNE = {
  id: LIEU,
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

const FICHE = {
  ...LIGNE,
  region: 'idf',
  acces_office: 'tres_difficile',
  stationnement: 'difficile',
  acces_details: 'Badge à retirer au PC sécurité',
  contraintes_horaires: null,
  flux_autorises: ['biodechet', 'dechet_residuel'],
  photos_urls: null,
  traiteurs: [
    { id: 't1', nom: 'Kaspia', nb_collectes: 12, tonnage_kg: 840 },
    { id: 't2', nom: 'Butard', nb_collectes: 3, tonnage_kg: 0 },
  ],
  demande_modification_possible: true,
  demande_modification_en_cours: false,
};

type Reponse = { status?: number; body: unknown };
let fiche: Reponse;
let demande: Reponse;
let evolution: Reponse;
const appels: { url: string; method: string; body: unknown }[] = [];

const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  appels.push({
    url,
    method,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  });
  const rep: Reponse = url.endsWith('/demande-modification')
    ? demande
    : url.includes('/api/v1/dashboards/evolution')
      ? evolution
      : url.endsWith(`/gestionnaire/lieux/${LIEU}`)
        ? fiche
        : { body: { data: [LIGNE] } };
  const status = rep.status ?? 200;
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(rep.body),
  } as Response);
});

beforeEach(() => {
  cleanup();
  appels.length = 0;
  redirect.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  fiche = { body: { data: FICHE } };
  demande = { status: 201, body: { data: { demandee: true } } };
  evolution = { body: { data: { granularite: 'mois', series: [] } } };
  window.history.replaceState(null, '', LISTE);
});

// Liste rendue, puis clic sur la ligne du lieu → la fiche (dialogue) chargée.
async function ouvrirFiche() {
  renderAvecToasts(<GestionnaireLieuxPage />);
  const [cellule] = await screen.findAllByText(
    'CNIT Forest',
    undefined,
    ATTENTE_UI,
  );
  fireEvent.click(cellule!);
  const dialogue = await screen.findByRole(
    'dialog',
    { name: 'CNIT Forest' },
    ATTENTE_UI,
  );
  return within(dialogue);
}

describe('M3.2 / fiche lieu en pop-up', () => {
  it(
    'M3.2/fiche_lieu_modale_ouverte_au_clic — la ligne ouvre la fiche sur la liste, l’adresse porte la fiche',
    async () => {
      const f = await ouvrirFiche();
      // Titre visible = grand en-tête de la fiche (le h2 du dialogue est réservé
      // aux lecteurs d'écran).
      expect(
        f.getByRole('heading', { name: 'CNIT Forest', level: 3 }),
      ).toBeTruthy();
      expect(window.location.pathname + window.location.search).toBe(
        `${LISTE}?lieu=${LIEU}`,
      );
      // La liste reste montée derrière la fiche (pas de changement de page).
      expect(
        screen.getByRole('heading', { name: 'Lieux' }),
      ).toBeInTheDocument();
      expect(
        f
          .getByTestId('fiche-lieu-infos')
          .textContent?.includes('2 Place de la Défense, 92800, Puteaux'),
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_lien_direct — ?lieu=<id> ouvre la fiche à l’arrivée',
    async () => {
      window.history.replaceState(null, '', `${LISTE}?lieu=${LIEU}`);
      renderAvecToasts(<GestionnaireLieuxPage />);
      expect(
        await screen.findByRole('dialog', { name: 'CNIT Forest' }, ATTENTE_UI),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_fermeture_nettoie_l_adresse — fermer rend la liste et son adresse',
    async () => {
      const f = await ouvrirFiche();
      fireEvent.click(f.getByRole('button', { name: 'Fermer' }));
      await waitFor(
        () => expect(screen.queryByRole('dialog')).toBeNull(),
        ATTENTE_UI,
      );
      expect(window.location.pathname + window.location.search).toBe(LISTE);
    },
    ATTENTE_CAS_MS,
  );

  it('M3.2/fiche_lieu_ancienne_route_redirige — /gestionnaire/lieux/<id> renvoie vers la liste, fiche ouverte', async () => {
    await FicheLieuGestionnaireRedirect({
      params: Promise.resolve({ id: LIEU }),
    });
    expect(redirect).toHaveBeenCalledWith(`${LISTE}?lieu=${LIEU}`);
  });

  it(
    'M3.2/fiche_lieu_modale_libelles_lisibles — région, difficultés d’accès et flux en clair',
    async () => {
      const f = await ouvrirFiche();
      // Région : libellé, pas la valeur de base « idf ».
      expect(f.getAllByText('Île-de-France').length).toBeGreaterThan(0);
      expect(f.queryByText('idf')).toBeNull();
      // Stationnement et accès office sont des niveaux de difficulté (§04),
      // jamais « Oui » / « Non ».
      expect(f.getByText('Difficile')).toBeTruthy();
      expect(f.getByText('Très difficile')).toBeTruthy();
      expect(f.queryByText('Oui')).toBeNull();
      expect(f.getByText('Biodéchets')).toBeTruthy();
      expect(f.getByText('Déchet résiduel')).toBeTruthy();
      expect(f.getByText(/^3\s500 pers\.$/)).toBeTruthy();
      // Libellé du CDC (§06.05 §3) pour l'adresse.
      expect(f.getByText('Adresse accès livraison')).toBeTruthy();
      expect(f.getByText('Badge à retirer au PC sécurité')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_onglet_traiteurs_liste_complete — tous les traiteurs opérant, avec collectes et tonnage',
    async () => {
      const f = await ouvrirFiche();
      const onglet = f.getByRole('tab', { name: 'Traiteurs (2)' });
      fireEvent.mouseDown(onglet);
      expect(
        await f.findByRole(
          'heading',
          { name: 'Traiteurs opérant sur ce lieu' },
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      // DataTable rend le tableau ET les cartes mobiles : on borne au tableau.
      const tableau = within(f.getByRole('table'));
      const lignes = tableau.getAllByRole('row').slice(1);
      expect(lignes.map((l) => l.textContent)).toEqual([
        expect.stringMatching(/^Kaspia12840\skg$/),
        'Butard3—',
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_onglet_traiteurs_vide — l’onglet reste présent et dit qu’il n’y a personne',
    async () => {
      fiche = { body: { data: { ...FICHE, traiteurs: [] } } };
      const f = await ouvrirFiche();
      fireEvent.mouseDown(f.getByRole('tab', { name: 'Traiteurs' }));
      expect(
        await f.findByText(
          "Aucun traiteur n'a encore eu de collecte sur ce lieu.",
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(f.queryByRole('table')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_activite_graphique_du_dashboard — onglet Activité : l’histogramme du dashboard, filtré sur le lieu, 12 derniers mois ; plus d’historique des collectes',
    async () => {
      evolution = {
        body: {
          data: {
            granularite: 'mois',
            series: [
              {
                periode: '2026-04-01',
                biodechet: 1200,
                emballage: 400,
                carton: 600,
                verre: 300,
                dechet_residuel: 3187,
                tonnage_total: 5687,
                taux_recyclage: 44,
              },
              {
                periode: '2026-09-01',
                biodechet: 1500,
                emballage: 500,
                carton: 700,
                verre: 400,
                dechet_residuel: 3304,
                tonnage_total: 6404,
                taux_recyclage: 48,
              },
            ],
          },
        },
      };
      const f = await ouvrirFiche();
      const appelsEvolution = () =>
        appels.filter((a) => a.url.includes('/dashboards/evolution'));
      // Rien n'est chargé tant que l'onglet n'est pas ouvert.
      expect(appelsEvolution()).toHaveLength(0);

      fireEvent.mouseDown(f.getByRole('tab', { name: 'Activité' }));
      expect(
        await f.findByText(
          'Évolution mensuelle Zéro Déchet',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      // Légende du graphique du dashboard : flux et taux de recyclage.
      expect(f.getByRole('button', { name: /Biodéchets/ })).toBeTruthy();
      expect(f.getByRole('button', { name: /Taux de recyclage/ })).toBeTruthy();

      // Même route que le dashboard : ZD, ce lieu seul, 12 derniers mois.
      expect(appelsEvolution()).toHaveLength(1);
      const usp = new URL(appelsEvolution()[0]!.url, 'http://x').searchParams;
      const periode = periodeDerniers(12, 'mois')!;
      expect(usp.get('type')).toBe('zero_dechet');
      expect(usp.getAll('lieu_ids[]')).toEqual([LIEU]);
      expect(usp.get('from')).toBe(periode.from);
      expect(usp.get('to')).toBe(periode.to);

      // L'historique des collectes et l'ancien graphique sont retirés.
      expect(f.queryByText(/Historique des collectes/)).toBeNull();
      expect(f.queryByTestId('lieu-evolution-12m')).toBeNull();
      expect(f.queryByRole('table')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_activite_sans_collecte — aucune collecte ZD clôturée sur 12 mois : état vide du graphique',
    async () => {
      const f = await ouvrirFiche();
      fireEvent.mouseDown(f.getByRole('tab', { name: 'Activité' }));
      expect(
        await f.findByText(
          'Aucune collecte ZD sur la période.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_activite_erreur — un chargement en échec n’est pas rendu comme « aucune collecte », « Réessayer » relance',
    async () => {
      evolution = { status: 500, body: { error: 'Erreur serveur' } };
      const f = await ouvrirFiche();
      fireEvent.mouseDown(f.getByRole('tab', { name: 'Activité' }));
      const alerte = await f.findByRole('alert', {}, ATTENTE_UI);
      expect(alerte).toHaveTextContent(
        "Impossible de charger l'activité de ce lieu",
      );
      expect(f.queryByText('Aucune collecte ZD sur la période.')).toBeNull();

      evolution = { body: { data: { granularite: 'mois', series: [] } } };
      fireEvent.click(f.getByRole('button', { name: 'Réessayer' }));
      expect(
        await f.findByText(
          'Aucune collecte ZD sur la période.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_lecture_seule — aucun champ de saisie, une seule action : la demande',
    async () => {
      const f = await ouvrirFiche();
      for (const onglet of ['Traiteurs (2)', 'Activité', 'Informations']) {
        fireEvent.mouseDown(f.getByRole('tab', { name: onglet }));
        expect(f.queryAllByRole('textbox')).toHaveLength(0);
        expect(f.queryAllByRole('combobox')).toHaveLength(0);
        expect(f.queryAllByRole('checkbox')).toHaveLength(0);
      }
      expect(f.queryByRole('button', { name: /Enregistrer|Modifier$/ })).toBe(
        null,
      );
      expect(f.getByRole('button', { name: BOUTON })).toBeEnabled();
      // Les seuls boutons de la fiche : fermer, et la demande.
      expect(
        f
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label') ?? b.textContent),
      ).toEqual(['Fermer', BOUTON]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_erreur_chargement — un échec n’est pas un lieu vide, « Réessayer » relance',
    async () => {
      fiche = { status: 500, body: {} };
      renderAvecToasts(<GestionnaireLieuxPage />);
      const [cellule] = await screen.findAllByText(
        'CNIT Forest',
        undefined,
        ATTENTE_UI,
      );
      fireEvent.click(cellule!);
      const alerte = await screen.findByRole('alert', {}, ATTENTE_UI);
      expect(alerte).toHaveTextContent('Impossible de charger ce lieu');
      expect(screen.queryByRole('button', { name: BOUTON })).toBeNull();

      fiche = { body: { data: FICHE } };
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        await screen.findByRole('dialog', { name: 'CNIT Forest' }, ATTENTE_UI),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_lieu_introuvable — 404 : message dédié, pas d’action',
    async () => {
      fiche = { status: 404, body: { error: 'Lieu non trouvé' } };
      window.history.replaceState(null, '', `${LISTE}?lieu=${LIEU}`);
      renderAvecToasts(<GestionnaireLieuxPage />);
      expect(
        await screen.findByText('Lieu non trouvé', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: BOUTON })).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / fiche lieu — identifiant de l’adresse', () => {
  it(
    'M3.2/fiche_lieu_modale_identifiant_mal_forme — ?lieu=. : « Lieu non trouvé », aucune requête de fiche',
    async () => {
      // « /lieux/. » serait normalisé par le navigateur vers la route de la
      // liste : la fiche recevrait un tableau et planterait.
      window.history.replaceState(null, '', `${LISTE}?lieu=.`);
      renderAvecToasts(<GestionnaireLieuxPage />);
      expect(
        await screen.findByText('Lieu non trouvé', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByRole('tab')).toBeNull();
      expect(
        appels.filter((a) => a.url.includes('/gestionnaire/lieux/.')),
      ).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / fiche lieu — demande de modification', () => {
  it(
    'M3.2/fiche_lieu_modale_hors_parc_sans_bouton — lieu lisible hors du parc : fiche en consultation, aucun bouton de demande',
    async () => {
      fiche = {
        body: { data: { ...FICHE, demande_modification_possible: false } },
      };
      const f = await ouvrirFiche();
      expect(f.getByRole('tab', { name: 'Traiteurs (2)' })).toBeTruthy();
      expect(f.queryByRole('button', { name: BOUTON })).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  const MESSAGE = 'La capacité est de 4 000 personnes.';

  async function ouvrirDemande() {
    const f = await ouvrirFiche();
    fireEvent.click(f.getByRole('button', { name: BOUTON }));
    const sousModale = within(
      await screen.findByRole('dialog', { name: BOUTON }, ATTENTE_UI),
    );
    return { f, sousModale };
  }

  it(
    'M3.2/fiche_lieu_modale_demande_envoyee — le texte part à la route, le bouton se neutralise, un toast confirme',
    async () => {
      const { f, sousModale } = await ouvrirDemande();
      const envoyer = sousModale.getByRole('button', {
        name: 'Envoyer la demande',
      });
      // Rien à envoyer tant que la précision manque.
      expect(envoyer).toBeDisabled();
      fireEvent.change(sousModale.getByRole('textbox'), {
        target: { value: MESSAGE },
      });
      expect(envoyer).toBeEnabled();
      fireEvent.click(envoyer);

      expect(
        await screen.findByText('Demande envoyée', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(appels.filter((a) => a.method === 'POST')).toEqual([
        {
          url: `/api/v1/gestionnaire/lieux/${LIEU}/demande-modification`,
          method: 'POST',
          body: { texte: MESSAGE },
        },
      ]);
      // Sous-modale refermée, fiche toujours ouverte, bouton neutralisé.
      expect(screen.queryByRole('dialog', { name: BOUTON })).toBeNull();
      expect(f.getByRole('button', { name: BOUTON })).toBeDisabled();
      expect(
        f.getByText(
          'Une demande de modification est en cours de traitement par l’équipe Savr.',
        ),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_demande_deja_en_cours — une demande ouverte : bouton neutralisé dès l’ouverture',
    async () => {
      fiche = {
        body: { data: { ...FICHE, demande_modification_en_cours: true } },
      };
      const f = await ouvrirFiche();
      expect(f.getByRole('button', { name: BOUTON })).toBeDisabled();
      expect(
        f.getByText(
          'Une demande de modification est en cours de traitement par l’équipe Savr.',
        ),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_demande_concurrente_409 — un collègue a déjà demandé : même état final, toast d’information',
    async () => {
      demande = {
        status: 409,
        body: {
          error: 'Une demande est déjà en cours de traitement pour ce lieu.',
        },
      };
      const { f, sousModale } = await ouvrirDemande();
      fireEvent.change(sousModale.getByRole('textbox'), {
        target: { value: MESSAGE },
      });
      fireEvent.click(
        sousModale.getByRole('button', { name: 'Envoyer la demande' }),
      );
      expect(
        await screen.findByText('Demande déjà en cours', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(f.getByRole('button', { name: BOUTON })).toBeDisabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_demande_refusee_message_affiche — refus serveur : motif affiché, saisie conservée',
    async () => {
      demande = {
        status: 422,
        body: { error: 'La demande ne doit pas dépasser 1000 caractères.' },
      };
      const { f, sousModale } = await ouvrirDemande();
      fireEvent.change(sousModale.getByRole('textbox'), {
        target: { value: MESSAGE },
      });
      fireEvent.click(
        sousModale.getByRole('button', { name: 'Envoyer la demande' }),
      );
      expect(
        await sousModale.findByText(
          'La demande ne doit pas dépasser 1000 caractères.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(sousModale.getByRole('textbox')).toHaveValue(MESSAGE);
      expect(f.getByRole('button', { name: BOUTON })).toBeEnabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_lieu_modale_echap_ferme_la_demande_seule — Échap referme la demande, pas la fiche',
    async () => {
      await ouvrirDemande();
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(
        () => expect(screen.queryByRole('dialog', { name: BOUTON })).toBeNull(),
        ATTENTE_UI,
      );
      expect(screen.getByRole('dialog', { name: 'CNIT Forest' })).toBeTruthy();
      expect(window.location.search).toBe(`?lieu=${LIEU}`);

      // Second Échap : la fiche se ferme à son tour.
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(
        () => expect(screen.queryByRole('dialog')).toBeNull(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});
