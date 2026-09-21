/**
 * M3.1 — Fiche collecte traiteur (§06.04 « Fiche collecte (vue détail) »).
 *
 * Sondes de RENDU : une route qui renvoie juste et une page qui n'affiche rien
 * passeraient les tests d'API. On vérifie donc ce que le traiteur VOIT :
 * l'entête complet (type + taille), le badge « Programmée par » et sa modale,
 * la date du titre en format FR (l'ISO brut de la DB ne s'affiche jamais),
 * l'état d'erreur distinct du « introuvable », et le gating du Bloc 3 ZD.
 *
 * `use(params)` ne se résout jamais sous Suspense dans cet environnement
 * (jsdom + React 19 + RTL 16) : on passe une promesse déjà marquée résolue au
 * sens de React — même geste que detail-evenement-gestionnaire.m3-2.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/traiteur/collectes/c1',
}));

import FicheCollectePage from '@/app/(traiteur)/traiteur/collectes/[id]/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const params = (id: string) =>
  Object.assign(Promise.resolve({ id }), {
    status: 'fulfilled',
    value: { id },
  });

function collecte(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    type: 'zero_dechet',
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null,
    date_collecte: '2026-12-10',
    heure_collecte: '22:00:00',
    controle_acces_requis: false,
    informations_completes: true,
    informations_supplementaires: null,
    notes_internes: null,
    taux_recyclage: null,
    realisee_at: null,
    aucun_repas_motif: null,
    taille_bracket: 'S',
    programmee_par: null,
    tournees: [],
    rapport_rse_disponible: false,
    rapport_rse_regenere: false,
    can_regenerate: false,
    factures: [],
    evenement: {
      id: 'e1',
      nom_evenement: 'Gala',
      pax: 279,
      type_evenement_id: 't1',
      nom_client_organisateur: null,
      reference_affaire: null,
      notes_internes: null,
      contact_principal_nom: 'Contact Kaspia',
      contact_principal_telephone: '+33 6 99 99 03 22',
      contact_secours_nom: null,
      contact_secours_telephone: null,
      type_evenement: { libelle: 'Cocktail apéritif' },
      lieu: {
        nom: 'Palais des Congrès de Paris',
        adresse_acces: '2 Place de la Porte Maillot',
        code_postal: '75017',
        ville: 'Paris',
      },
    },
    ...over,
  };
}

/** Routeur de fetch : détail, benchmark de la fiche, options de filtres. */
function stubFetch(detail: unknown, opts: { detailKo?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/benchmark/filtres'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ data: { lieux: [], traiteurs: [], types: [] } }),
        } as Response);
      if (String(url).includes('/benchmark'))
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              data: {
                taille_evenement: 'S',
                flux: {
                  biodechet: {
                    ratio_user: 0.4,
                    benchmark_kg_pax: 0.3,
                    nb_collectes_segment: 11,
                  },
                },
              },
            }),
        } as Response);
      if (opts.detailKo)
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'boom' }),
        } as Response);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: detail }),
      } as Response);
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M3.1 / fiche collecte traiteur — entête (§06.04)', () => {
  it(
    'M3.1/fiche_ui_entete_type_et_taille — type d’événement + bracket affichés',
    async () => {
      stubFetch(collecte());
      render(<FicheCollectePage params={params('c1')} />);

      await screen.findByText('Cocktail apéritif', {}, ATTENTE_UI);
      expect(screen.getByText('Type d’événement')).toBeTruthy();
      expect(screen.getByText('S')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_titre_date_fr — la date du titre n’est jamais l’ISO de la DB',
    async () => {
      stubFetch(collecte());
      render(<FicheCollectePage params={params('c1')} />);

      const titre = await screen.findByRole(
        'heading',
        { level: 1 },
        ATTENTE_UI,
      );
      expect(titre.textContent).toContain('10/12/2026');
      expect(titre.textContent).not.toContain('2026-12-10');
      // Titre composite §06.04 : date - lieu - (client organisateur) - pax
      expect(titre.textContent).toContain('Palais des Congrès de Paris');
      expect(titre.textContent).toContain('279 pax');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_programmee_par_modale — badge tiers → modale nom + type + contact',
    async () => {
      stubFetch(
        collecte({
          programmee_par: {
            nom: 'Agence Caromy',
            type: 'agence',
            email: 'contact@caromy.fr',
          },
        }),
      );
      render(<FicheCollectePage params={params('c1')} />);

      const badge = await screen.findByTestId(
        'badge-programmee-par',
        {},
        ATTENTE_UI,
      );
      // Forme exacte du CDC : « Programmée par {nom} ({type}) ». Le nom seul
      // passerait un `toContain` trop faible — le type doit être DANS le badge.
      expect(badge.textContent).toBe('Programmée par Agence Caromy (agence)');

      fireEvent.click(badge);
      const modale = await screen.findByText(
        /Vous êtes le traiteur opérationnel sur place/,
        {},
        ATTENTE_UI,
      );
      expect(modale.textContent).toContain('agence');
      expect(screen.getByText('contact@caromy.fr')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_programmee_par_absent — collecte de son organisation : pas de badge',
    async () => {
      stubFetch(collecte({ programmee_par: null }));
      render(<FicheCollectePage params={params('c1')} />);

      await screen.findByText('Cocktail apéritif', {}, ATTENTE_UI);
      expect(screen.queryByTestId('badge-programmee-par')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / fiche collecte traiteur — états système (§10 §7)', () => {
  it(
    'M3.1/fiche_ui_erreur_reessayer — un 500 n’affiche pas « Collecte introuvable »',
    async () => {
      stubFetch(null, { detailKo: true });
      render(<FicheCollectePage params={params('c1')} />);

      await screen.findByTestId('fiche-erreur', {}, ATTENTE_UI);
      expect(
        screen.getByText(/chargement de la collecte a échoué/),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
      expect(screen.queryByText('Collecte introuvable')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / fiche collecte traiteur — Bloc 3 ZD (§06.04)', () => {
  it(
    'M3.1/fiche_ui_bloc3_masque_avant_realisation — ZD programmée : pas de jauges',
    async () => {
      stubFetch(collecte({ statut: 'programmee' }));
      render(<FicheCollectePage params={params('c1')} />);

      await screen.findByText('Cocktail apéritif', {}, ATTENTE_UI);
      expect(screen.queryByTestId('bloc-3-zd-fiche')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  // Les DEUX statuts terminaux de §06.04 l.443, chacun à son tour : une
  // régression qui les séparerait ne passerait pas inaperçue.
  it.each(['cloturee', 'realisee'])(
    'M3.1/fiche_ui_bloc3_visible_zd_terminee — jauges + encart de filtres (%s)',
    async (statut) => {
      stubFetch(collecte({ statut }));
      render(<FicheCollectePage params={params('c1')} />);

      const bloc = await screen.findByTestId('bloc-3-zd-fiche', {}, ATTENTE_UI);
      // Les 5 flux ZD sont tous représentés (§06.04 « 1 jauge par flux ZD »),
      // même quand la collecte n'a qu'un flux pesé.
      expect(bloc.textContent).toContain('Biodéchets');
      expect(bloc.textContent).toContain('Déchet résiduel');
      // Encart de filtres du repère imbriqué DANS la carte des jauges.
      expect(bloc.textContent).toContain('Réinitialiser');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_bloc3_filtres_initialises_sur_la_collecte — la requête porte le segment (type × taille)',
    async () => {
      // Sonde de la CHAÎNE : l'encart émet ses défauts au montage, la page en
      // fait une requête. Sans cela le bloc s'afficherait vide en production
      // alors que les libellés de flux, eux, seraient bien rendus.
      stubFetch(collecte({ statut: 'cloturee' }));
      render(<FicheCollectePage params={params('c1')} />);
      await screen.findByTestId('bloc-3-zd-fiche', {}, ATTENTE_UI);

      const urlsAppelees = (): string[] =>
        (
          globalThis.fetch as unknown as { mock: { calls: unknown[][] } }
        ).mock.calls.map((c) => String(c[0]));
      const requete = await waitFor(() => {
        const u = urlsAppelees().find((u) => u.includes('/benchmark?'));
        if (!u) throw new Error('aucune requête benchmark émise');
        return u;
      }, ATTENTE_UI);
      // §06.04 « Initialisation » : type d'événement ET taille de CETTE collecte.
      expect(requete).toContain('type_evenement_ids=t1');
      expect(requete).toContain('taille_evenement_codes=S');
      // …et la période par défaut (12 mois glissants) est bornée.
      expect(requete).toContain('periode_debut=');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_bloc3_masque_en_ag — le benchmark ZD ne s’affiche pas sur une collecte AG',
    async () => {
      stubFetch(collecte({ type: 'anti_gaspi', statut: 'cloturee' }));
      render(<FicheCollectePage params={params('c1')} />);

      await screen.findByText('Cocktail apéritif', {}, ATTENTE_UI);
      expect(screen.queryByTestId('bloc-3-zd-fiche')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
