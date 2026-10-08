/**
 * M0.6 — Fiche collecte Admin, bloc « Chauffeur » : état RÉEL de l'email « infos
 * d'accès » et bouton « Renvoyer l'email » (décision Val 2026-10-08, C2-C3).
 *
 * Avant : « Email envoyé au programmateur » s'affichait dès que le tampon de la
 * collecte était posé, c'est-à-dire avant l'envoi. L'écran lit maintenant
 * `infos_acces_email`, servi par la fiche à partir du journal des emails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import { CollecteDetailPanel } from './collecte-detail-panel';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

type Suivi = {
  etat: 'a_envoyer' | 'envoye' | 'en_reprise' | 'non_remis';
  date: string | null;
  tentative: number | null;
  motif: 'tentatives_epuisees' | 'adresse_refusee' | null;
};

const suivi = (s: Partial<Suivi> & Pick<Suivi, 'etat'>): Suivi => ({
  date: '2026-10-08T07:00:01.000Z',
  tentative: 1,
  motif: null,
  ...s,
});

const tournee = (surcharge: Record<string, unknown> = {}) => ({
  id: 'tour-1',
  statut: 'planifiee',
  tms_reference: 'TMS-42',
  external_ref_commande: 'CMD-42',
  plaque_immatriculation: 'AB-123-CD',
  chauffeur_nom: 'Jean Martin',
  chauffeur_telephone: '0600000000',
  accompagnant_nom: null,
  accompagnant_telephone: null,
  ...surcharge,
});

// Fixture alignée sur collecte-detail-panel-infos-acces.r-ui-1.test.tsx : lieu à
// contrôle d'accès, une tournée dispatchée aux coordonnées complètes.
const collecte = (surcharge: Record<string, unknown> = {}) => ({
  id: 'c1',
  type: 'anti_gaspi',
  statut: 'programmee',
  statut_tms: 'envoye',
  statut_tms_at: null,
  dirty_tms: false,
  date_collecte: '2026-10-10',
  heure_collecte: '19:00:00',
  nb_camions_demande: 1,
  tms_reference: null,
  volume_estime_repas: 12,
  controle_acces_requis: true,
  infos_acces_email_envoye_at: '2026-10-08T07:00:00.000Z',
  infos_acces_email: suivi({ etat: 'envoye' }),
  notes_internes: null,
  informations_supplementaires: null,
  motif_override_prestataire: null,
  annulee_cote_savr: false,
  pack_antgaspi_id: null,
  packs_antgaspi: null,
  prestataire_logistique_id: null,
  attributions_antgaspi: {
    id: 'attr-1',
    mode_validation: 'manuel_top1',
    valide_at: null,
    volume_repas_realise: null,
    associations: { nom: 'Les Restos du Cœur' },
    transporteurs: null,
  },
  evenements: {
    nom_evenement: 'Cocktail AG',
    pax: 80,
    nom_client_organisateur: 'Client Fallback',
    organisations: { raison_sociale: 'Traiteur Beta' },
    client_organisateur: { raison_sociale: 'Org Cliente SA' },
    lieux: { nom: 'Pavillon', ville: 'Paris', adresse_acces: '1 rue X' },
    types_evenements: { libelle: 'Cocktail apéritif' },
  },
  collecte_flux: [],
  collecte_tournees: [{ rang: 1, tournees: tournee() }],
  factures_collectes: [],
  ...surcharge,
});

interface Scenario {
  /** Fiches servies par les GET successifs (la dernière est répétée). */
  fiches: Array<Record<string, unknown>>;
  patch?: Record<string, unknown>;
  renvoi?: { ok: boolean; status?: number; corps: Record<string, unknown> };
}

function mockFetch(scenario: Scenario) {
  let lectures = 0;
  const fetchMock = vi.fn(
    (url: string, opts?: { method?: string; body?: string }) => {
      const method = opts?.method ?? 'GET';
      const json = (corps: unknown, ok = true, status = 200) =>
        Promise.resolve({ ok, status, json: async () => corps });
      if (url.endsWith('/infos-acces/renvoi') && method === 'POST') {
        const r = scenario.renvoi ?? { ok: true, corps: { email: 'envoye' } };
        return json(r.corps, r.ok, r.status ?? (r.ok ? 200 : 409));
      }
      if (url.endsWith('/infos-acces') && method === 'PATCH') {
        return json(scenario.patch ?? { email_envoye: true, email: 'envoye' });
      }
      if (url.startsWith('/api/v1/admin/transporteurs')) {
        return json({ data: [] });
      }
      if (url.includes('/recommandation')) {
        return json({
          data: {
            associations: [],
            assoc_count: 0,
            transporteur: null,
            transporteurs: [],
            branche: 'ag_marathon_nuit',
            is_idf: true,
            no_asso: true,
            no_prestataire: true,
            delai_minutes: 600,
            nb_pax: 80,
          },
        });
      }
      if (url.includes('/associations')) return json({ data: [] });
      if (url.endsWith('/documents')) {
        return json({
          rapport: null,
          bordereau: null,
          attestation: null,
          photos: [],
        });
      }
      if (url.endsWith('/audit')) return json({ data: [], recredit_at: null });
      // GET fiche : chargement initial puis rechargements.
      const fiche =
        scenario.fiches[Math.min(lectures, scenario.fiches.length - 1)];
      lectures += 1;
      return json(fiche);
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Ouvre l'onglet Logistique et rend le bloc d'état de l'email. */
async function blocEtat(): Promise<HTMLElement> {
  // Radix active un onglet au mousedown (bouton gauche), pas au click.
  fireEvent.mouseDown(
    await screen.findByRole('tab', { name: 'Logistique' }, ATTENTE_UI),
    { button: 0 },
  );
  return screen.findByTestId('etat-email-infos-acces', undefined, ATTENTE_UI);
}

const boutonRenvoi = (nom: string) =>
  screen.queryByRole('button', { name: nom });

async function afficher(fiche: Record<string, unknown>): Promise<HTMLElement> {
  mockFetch({ fiches: [fiche] });
  renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
  return blocEtat();
}

describe('M0.6 — fiche collecte Admin : état réel de l’email « infos d’accès »', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it(
    'email parti → « Email envoyé au programmateur le … » (date de l’envoi, à Paris) + bouton « Renvoyer l’email »',
    async () => {
      const bloc = await afficher(
        collecte({
          infos_acces_email: suivi({
            etat: 'envoye',
            // 23 h 30 UTC le 8 = le 9 à Paris.
            date: '2026-10-08T23:30:00.000Z',
          }),
        }),
      );
      expect(bloc).toHaveTextContent(
        'Email envoyé au programmateur le 09/10/2026',
      );
      expect(boutonRenvoi('Renvoyer l’email')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'tampon posé MAIS email en reprise → jamais « envoyé » : avertissement, nombre de tentatives, pas de bouton de renvoi',
    async () => {
      const bloc = await afficher(
        collecte({
          infos_acces_email: suivi({ etat: 'en_reprise', tentative: 2 }),
        }),
      );
      expect(bloc).toHaveTextContent(
        'L’email au programmateur n’est pas encore parti.',
      );
      expect(bloc).toHaveTextContent('(2 tentatives sur 4 en échec)');
      expect(bloc).not.toHaveTextContent('Email envoyé au programmateur');
      // Un renvoi pendant la reprise ferait partir deux emails.
      expect(boutonRenvoi('Renvoyer l’email')).not.toBeInTheDocument();
      expect(boutonRenvoi('Envoyer l’email')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'une seule tentative en échec → singulier',
    async () => {
      const bloc = await afficher(
        collecte({
          infos_acces_email: suivi({ etat: 'en_reprise', tentative: 1 }),
        }),
      );
      expect(bloc).toHaveTextContent('(1 tentative sur 4 en échec)');
    },
    ATTENTE_CAS_MS,
  );

  it(
    '4 tentatives épuisées → erreur annoncée (role alert) + bouton « Renvoyer l’email »',
    async () => {
      const bloc = await afficher(
        collecte({
          infos_acces_email_envoye_at: null,
          infos_acces_email: suivi({
            etat: 'non_remis',
            tentative: 4,
            motif: 'tentatives_epuisees',
          }),
        }),
      );
      const alerte = within(bloc).getByRole('alert');
      expect(alerte).toHaveTextContent(
        'L’email n’a pas pu être envoyé au programmateur (4 tentatives en échec).',
      );
      expect(alerte).toHaveTextContent(
        'Renvoyez-le ou transmettez les coordonnées par téléphone.',
      );
      expect(bloc).not.toHaveTextContent('Email envoyé au programmateur');
      expect(boutonRenvoi('Renvoyer l’email')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'adresse refusée par la messagerie du programmateur → le motif est dit, avec la marche à suivre',
    async () => {
      const bloc = await afficher(
        collecte({
          infos_acces_email_envoye_at: null,
          infos_acces_email: suivi({
            etat: 'non_remis',
            motif: 'adresse_refusee',
          }),
        }),
      );
      expect(bloc).toHaveTextContent(
        'L’email n’a pas été remis : la messagerie du programmateur l’a refusé.',
      );
      expect(bloc).toHaveTextContent('Vérifiez son adresse');
      expect(bloc).not.toHaveTextContent('4 tentatives');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rien d’envoyé, coordonnées incomplètes → « En attente : infos à compléter », pas de bouton',
    async () => {
      const bloc = await afficher(
        collecte({
          infos_acces_email_envoye_at: null,
          infos_acces_email: suivi({ etat: 'a_envoyer', date: null }),
          collecte_tournees: [
            { rang: 1, tournees: tournee({ chauffeur_telephone: null }) },
          ],
        }),
      );
      expect(bloc).toHaveTextContent(
        'En attente : infos à compléter avant envoi de l’email.',
      );
      expect(boutonRenvoi('Envoyer l’email')).not.toBeInTheDocument();
      expect(boutonRenvoi('Renvoyer l’email')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rien d’envoyé, coordonnées complètes → l’écran le dit et propose « Envoyer l’email »',
    async () => {
      const bloc = await afficher(
        collecte({
          infos_acces_email_envoye_at: null,
          infos_acces_email: suivi({ etat: 'a_envoyer', date: null }),
        }),
      );
      expect(bloc).toHaveTextContent(
        'Coordonnées complètes : l’email n’a pas encore été envoyé au programmateur.',
      );
      expect(boutonRenvoi('Envoyer l’email')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'deux camions demandés dont un sans téléphone → coordonnées incomplètes, pas de bouton',
    async () => {
      await afficher(
        collecte({
          nb_camions_demande: 2,
          infos_acces_email_envoye_at: null,
          infos_acces_email: suivi({ etat: 'a_envoyer', date: null }),
          collecte_tournees: [
            { rang: 1, tournees: tournee() },
            {
              rang: 2,
              tournees: tournee({ id: 'tour-2', chauffeur_telephone: '  ' }),
            },
          ],
        }),
      );
      expect(boutonRenvoi('Envoyer l’email')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'collecte terminée → plus de bouton de renvoi',
    async () => {
      const bloc = await afficher(collecte({ statut: 'realisee' }));
      expect(bloc).toHaveTextContent('Email envoyé au programmateur');
      expect(boutonRenvoi('Renvoyer l’email')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'fiche servie sans `infos_acces_email` (réponse antérieure au suivi) → repli sur le tampon',
    async () => {
      const ancienne = collecte();
      delete (ancienne as Record<string, unknown>)['infos_acces_email'];
      const bloc = await afficher(ancienne);
      expect(bloc).toHaveTextContent(
        'Email envoyé au programmateur le 08/10/2026',
      );
    },
    ATTENTE_CAS_MS,
  );
});

describe('M0.6 — fiche collecte Admin : bouton « Renvoyer l’email »', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const nonRemise = collecte({
    infos_acces_email_envoye_at: null,
    infos_acces_email: suivi({
      etat: 'non_remis',
      tentative: 4,
      motif: 'tentatives_epuisees',
    }),
  });

  async function cliquerRenvoi(scenario: Scenario) {
    const fetchMock = mockFetch(scenario);
    renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
    await blocEtat();
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Renvoyer l’email' },
        ATTENTE_UI,
      ),
    );
    return fetchMock;
  }

  it(
    'clic → POST …/infos-acces/renvoi, toast de succès, fiche rechargée : l’état affiché devient « envoyé »',
    async () => {
      const fetchMock = await cliquerRenvoi({
        fiches: [
          nonRemise,
          collecte({
            infos_acces_email: suivi({
              etat: 'envoye',
              date: '2026-10-09T10:00:00.000Z',
            }),
          }),
        ],
        renvoi: { ok: true, corps: { email: 'envoye' } },
      });

      expect(
        await screen.findByText(
          'Email envoyé au programmateur.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/collectes/c1/infos-acces/renvoi',
        { method: 'POST' },
      );
      expect(
        await screen.findByText(
          /Email envoyé au programmateur le 09\/10\/2026/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it.each([
    [
      'en_reprise',
      'L’email n’est pas parti : une nouvelle tentative aura lieu automatiquement.',
    ],
    ['non_envoye', 'L’email au programmateur n’a pas pu être envoyé.'],
    [
      'sans_objet',
      'Aucun email n’est parti : le nom et le téléphone du chauffeur doivent être renseignés pour chaque camion.',
    ],
  ])(
    'renvoi dont l’issue est « %s » → le message ne dit PAS « envoyé »',
    async (issue, message) => {
      await cliquerRenvoi({
        fiches: [nonRemise],
        renvoi: { ok: true, corps: { email: issue } },
      });

      expect(
        await screen.findByText(message, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Email envoyé au programmateur.'),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'renvoi refusé (409 : reprise en cours) → le motif du refus est affiché, aucun toast de succès',
    async () => {
      await cliquerRenvoi({
        fiches: [nonRemise],
        renvoi: {
          ok: false,
          status: 409,
          corps: {
            error:
              'Une nouvelle tentative d’envoi est déjà en cours pour cet email.',
          },
        },
      });

      expect(
        await screen.findByText(
          'Une nouvelle tentative d’envoi est déjà en cours pour cet email.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Email envoyé au programmateur.'),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M0.6 — fiche collecte Admin : message après enregistrement des coordonnées', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  async function enregistrer(patch: Record<string, unknown>): Promise<void> {
    mockFetch({ fiches: [collecte()], patch });
    renderAvecToasts(<CollecteDetailPanel collecteId="c1" />);
    await blocEtat();
    fireEvent.click(
      await screen.findByRole(
        'button',
        { name: 'Modifier les coordonnées' },
        ATTENTE_UI,
      ),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Enregistrer' }, ATTENTE_UI),
    );
  }

  it.each([
    [
      'en_reprise',
      'Infos enregistrées. L’email au programmateur n’est pas parti : une nouvelle tentative aura lieu automatiquement.',
    ],
    [
      'non_envoye',
      'Infos enregistrées. L’email au programmateur n’a pas pu être envoyé.',
    ],
  ])(
    'email « %s » → le message dit que l’email n’est pas parti',
    async (issue, message) => {
      await enregistrer({ email_envoye: false, email: issue });

      expect(
        await screen.findByText(message, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Infos enregistrées — email récapitulatif envoyé au programmateur.',
        ),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rien à envoyer (« sans_objet ») → « Infos enregistrées. »',
    async () => {
      await enregistrer({ email_envoye: false, email: 'sans_objet' });
      expect(
        await screen.findByText('Infos enregistrées.', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});
