/**
 * M3.1 — Pop-up fiche collecte CLIENT, espace traiteur (§06.04 « Fiche collecte
 * (vue détail) », refonte Val 2026-09-29 — Q1 à Q7).
 *
 * Sondes de RENDU : une route qui renvoie juste et un écran qui n'affiche rien
 * passeraient les tests d'API. On vérifie ce que le traiteur VOIT : en-tête
 * (badge type, réf., lieu, date · heure · pax, frise client), onglets en
 * colonne, Informations / Logistique / Bilan & documents par type et par état,
 * absence de tout libellé « transporteur » / « prestataire », et la garde
 * Échap des sous-modales.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/traiteur/collectes',
}));

import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import {
  ficheClient,
  stubFetchFiche,
  urlsAppelees,
} from '@/test-utils/fiche-collecte-client';

const fiche = (id: string, onClose: () => void = () => {}) => (
  <FicheCollecteClientModal
    espace="traiteur"
    collecteId={id}
    onClose={onClose}
  />
);

// Radix Tabs réagit au mousedown (pas au click) sous jsdom.
async function ouvrirOnglet(nom: string): Promise<void> {
  fireEvent.mouseDown(
    await screen.findByRole('tab', { name: nom }, ATTENTE_UI),
  );
}

async function sousLigne(): Promise<string> {
  const el = await screen.findByTestId('fiche-sous-ligne', {}, ATTENTE_UI);
  return (el.textContent ?? '').replace(/\s/g, ' ');
}

// Tout le texte visible de la fiche, onglet par onglet (Radix ne rend que
// l'onglet actif).
async function texteDesTroisOnglets(): Promise<string> {
  const morceaux: string[] = [];
  for (const nom of ['Informations', 'Logistique', 'Bilan & documents']) {
    await ouvrirOnglet(nom);
    await screen.findByRole('tabpanel', {}, ATTENTE_UI);
    morceaux.push(document.body.textContent ?? '');
  }
  return morceaux.join(' ');
}

const ZD_REALISEE = {
  statut: 'cloturee',
  taux_recyclage: 78.4,
  co2_net_kg: 312,
  bilan_flux: {
    biodechet: 420,
    emballage: 180,
    carton: 120,
    verre: 90,
    dechet_residuel: 60,
  },
  rapport_rse_disponible: true,
  actions: { modifier: 'absent', annuler: 'absent', annulation: null },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M3.1 / pop-up fiche collecte client — en-tête (Q1, Q2)', () => {
  it(
    'M3.1/fiche_popup_entete_badge_frise — badge ZD navy, réf., lieu, date · heure · pax, frise client',
    async () => {
      stubFetchFiche(ficheClient({ statut: 'validee' }));
      render(fiche('c1'));

      const badge = await screen.findByTestId(
        'badge-type-collecte',
        {},
        ATTENTE_UI,
      );
      expect(badge.textContent).toBe('Zéro Déchet');
      // Q2 : ZD = navy primary-700, texte blanc (plus de cadre vert).
      expect(badge.className).toContain('bg-savr-primary-700');
      expect(badge.className).toContain('text-savr-white');
      expect(screen.getByText('Réf. C1')).toBeTruthy();
      expect(
        screen.getByRole('heading', {
          level: 3,
          name: 'Paris Expo Porte de Versailles',
        }),
      ).toBeTruthy();
      const ligne = await sousLigne();
      expect(ligne).toContain('Mercredi 28 octobre 2026 · 22:00');
      expect(ligne).toContain('4 200 pax');
      // Jamais l'ISO de la base.
      expect(ligne).not.toContain('2026-10-28');

      // Q1 : vocabulaire client, étape courante marquée.
      const frise = screen.getByTestId('frise-statut-client');
      expect(frise.textContent).toContain('Créée');
      expect(frise.textContent).toContain('Réalisée');
      expect(frise.textContent).not.toMatch(/Programmée|Clôturée/);
      const courante = within(frise).getByText('Validée').closest('li');
      expect(courante?.getAttribute('aria-current')).toBe('step');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_badge_ag_orange — AG : badge accent-500, texte primary-950',
    async () => {
      stubFetchFiche(ficheClient({ type: 'anti_gaspi' }));
      render(fiche('c1'));

      const badge = await screen.findByTestId(
        'badge-type-collecte',
        {},
        ATTENTE_UI,
      );
      expect(badge.textContent).toBe('Anti-Gaspi');
      expect(badge.className).toContain('bg-savr-accent-500');
      expect(badge.className).toContain('text-savr-primary-950');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_titre_date_fr — nom accessible du dialogue : lieu + date en FR, jamais l’ISO',
    async () => {
      stubFetchFiche(ficheClient());
      render(fiche('c1'));

      const dialogue = await screen.findByRole(
        'dialog',
        { name: /Paris Expo Porte de Versailles/ },
        ATTENTE_UI,
      );
      const nom = dialogue.getAttribute('aria-labelledby');
      const titre = nom ? document.getElementById(nom)?.textContent : '';
      expect(titre).toContain('Collecte Zéro Déchet');
      expect(titre).toContain('Mercredi 28 octobre 2026');
      expect(titre).not.toContain('2026-10-28');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_onglets_colonne — Informations / Logistique / Bilan & documents, verticaux',
    async () => {
      stubFetchFiche(ficheClient());
      render(fiche('c1'));

      const liste = await screen.findByRole('tablist', {}, ATTENTE_UI);
      expect(liste.getAttribute('aria-orientation')).toBe('vertical');
      expect(
        within(liste)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['Informations', 'Logistique', 'Bilan & documents']);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / pop-up — onglet Informations', () => {
  it(
    'M3.1/fiche_ui_entete_type_et_taille — type d’événement + bracket affichés',
    async () => {
      stubFetchFiche(ficheClient());
      render(fiche('c1'));

      await screen.findByText('Cocktail apéritif', {}, ATTENTE_UI);
      expect(screen.getByText('Type d’événement')).toBeTruthy();
      expect(screen.getByText('XL')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_informations_blocs — Événement, Lieu (contrôle + instructions), Contacts sur place',
    async () => {
      stubFetchFiche(ficheClient());
      render(fiche('c1'));

      const evenement = await screen.findByTestId(
        'bloc-evenement',
        {},
        ATTENTE_UI,
      );
      expect(evenement.textContent).toContain('Maison Client');
      expect(evenement.textContent).toContain('28 oct. 2026, 22:00');
      const lieu = screen.getByTestId('bloc-lieu');
      expect(lieu.textContent).toContain('1 Place de la Porte de Versailles');
      expect(lieu.textContent).toContain('Contrôle d’accès');
      expect(lieu.textContent).toContain('Oui');
      // Instructions d'accès = détails d'accès effectifs + infos de la collecte.
      expect(lieu.textContent).toContain('Entrée logistique hall 7');
      expect(lieu.textContent).toContain('Quai B, badge à l’accueil');
      const contacts = screen.getByTestId('bloc-contacts');
      expect(contacts.textContent).toContain('Paul Contact');
      expect(
        within(contacts)
          .getByRole('link', { name: '+33 6 11 22 33 44' })
          .getAttribute('href'),
      ).toBe('tel:+33611223344');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_contact_secours — affiché si renseigné, ligne masquée si vide (Q4)',
    async () => {
      stubFetchFiche(
        ficheClient({
          evenement: {
            ...ficheClient().evenement!,
            contact_secours_nom: 'Léa Secours',
            contact_secours_telephone: '+33 6 55 44 33 22',
          },
        }),
      );
      const { unmount } = render(fiche('c1'));
      const contacts = await screen.findByTestId(
        'bloc-contacts',
        {},
        ATTENTE_UI,
      );
      expect(contacts.textContent).toContain('Contact de secours');
      expect(contacts.textContent).toContain('Léa Secours');
      unmount();

      stubFetchFiche(ficheClient());
      render(fiche('c1'));
      const sansSecours = await screen.findByTestId(
        'bloc-contacts',
        {},
        ATTENTE_UI,
      );
      expect(sansSecours.textContent).not.toContain('Contact de secours');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_programmee_par_modale — badge tiers → modale nom + type + contact',
    async () => {
      stubFetchFiche(
        ficheClient({
          programmee_par: {
            nom: 'Agence Caromy',
            type: 'agence',
            email: 'contact@caromy.fr',
          },
        }),
      );
      render(fiche('c1'));

      const badge = await screen.findByTestId(
        'badge-programmee-par',
        {},
        ATTENTE_UI,
      );
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
      stubFetchFiche(ficheClient({ programmee_par: null }));
      render(fiche('c1'));

      await screen.findByText('Cocktail apéritif', {}, ATTENTE_UI);
      expect(screen.queryByTestId('badge-programmee-par')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / pop-up — états système (§10 §7)', () => {
  it(
    'M3.1/fiche_ui_erreur_reessayer — un 500 n’affiche pas « Collecte introuvable »',
    async () => {
      stubFetchFiche(null, { detailStatus: 500 });
      render(fiche('c1'));

      await screen.findByTestId('fiche-erreur', {}, ATTENTE_UI);
      expect(
        screen.getByText(/chargement de la collecte a échoué/),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
      expect(screen.queryByText('Collecte introuvable.')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_404_introuvable — collecte hors périmètre : « introuvable », pas « Réessayer »',
    async () => {
      stubFetchFiche(null, { detailStatus: 404 });
      render(fiche('c1'));

      await screen.findByText('Collecte introuvable.', {}, ATTENTE_UI);
      expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
      expect(screen.queryByTestId('fiche-erreur')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / pop-up — navigation fiche → fiche', () => {
  it(
    'M3.1/fiche_ui_reponse_lente_ignoree — la fiche quittée n’écrase pas la nouvelle',
    async () => {
      let resoudreLente: ((v: unknown) => void) | undefined;
      const lente = new Promise((r) => {
        resoudreLente = r;
      });
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          const u = String(url);
          if (u.endsWith('/c1'))
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => lente,
            } as Response);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                data: ficheClient({ id: 'c2', heure_collecte: '08:30:00' }),
              }),
          } as Response);
        }),
      );

      const { rerender } = render(fiche('c1'));
      rerender(fiche('c2'));
      expect(await sousLigne()).toContain('08:30');

      resoudreLente?.({
        data: ficheClient({ id: 'c1', heure_collecte: '22:00:00' }),
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(await sousLigne()).toContain('08:30');
      expect(await sousLigne()).not.toContain('22:00');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_reload_manuel_perime_ignore — le rechargement post-annulation ne ressuscite pas la fiche quittée',
    async () => {
      let resoudreReload: ((v: unknown) => void) | undefined;
      const reloadLent = new Promise((r) => {
        resoudreReload = r;
      });
      let detailC1Servi = false;
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: { method?: string }) => {
          const u = String(url);
          if (init?.method === 'POST')
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ data: {} }),
            } as Response);
          if (u.endsWith('/c1')) {
            if (detailC1Servi)
              return Promise.resolve({
                ok: true,
                status: 200,
                json: () => reloadLent,
              } as Response);
            detailC1Servi = true;
            return Promise.resolve({
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({
                  data: ficheClient({
                    statut: 'programmee',
                    actions: {
                      modifier: 'actif',
                      annuler: 'actif',
                      annulation: 'directe',
                    },
                  }),
                }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                data: ficheClient({ id: 'c2', heure_collecte: '08:30:00' }),
              }),
          } as Response);
        }),
      );

      const { rerender } = render(fiche('c1'));
      expect(await sousLigne()).toContain('22:00');

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Annuler la collecte' },
          ATTENTE_UI,
        ),
      );
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Confirmer l’annulation' },
          ATTENTE_UI,
        ),
      );

      rerender(fiche('c2'));
      expect(await sousLigne()).toContain('08:30');

      // Non-vacuité : le reload post-annulation est bien parti.
      const getsDetailC1 = urlsAppelees().filter(
        (c) => c.url.endsWith('/c1') && c.method !== 'POST',
      );
      expect(getsDetailC1).toHaveLength(2);

      resoudreReload?.({ data: ficheClient({ heure_collecte: '22:00:00' }) });
      await new Promise((r) => setTimeout(r, 0));

      expect(await sousLigne()).toContain('08:30');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / pop-up — onglet Logistique (wording Savr, Q3)', () => {
  const tournee = {
    plaque_immatriculation: 'AB-123-CD',
    chauffeur_nom: 'Jean Dupont',
    chauffeur_telephone: '+33 6 12 34 56 78',
    type_vehicule: 'camionnette',
  };

  it(
    'M3.1/fiche_ui_logistique_chauffeur_plaque_tel — nom, plaque, téléphone, sans contrôle d’accès',
    async () => {
      stubFetchFiche(
        ficheClient({ controle_acces_requis: false, tournees: [tournee] }),
      );
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      const bloc = await screen.findByTestId('bloc-logistique', {}, ATTENTE_UI);
      expect(bloc.textContent).toContain('Jean Dupont');
      expect(bloc.textContent).toContain('AB-123-CD');
      const tel = within(bloc).getByRole('link', { name: '+33 6 12 34 56 78' });
      expect(tel.getAttribute('href')).toBe('tel:+33612345678');
      expect(bloc.textContent).not.toContain('Communiqué');
      expect(bloc.textContent).not.toContain('Camion 1');
      // Coordonnées complètes : plus de demande urgente proposée.
      expect(screen.queryByTestId('zone-urgence')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_logistique_multi_camions_en_attente — un bloc par camion, champs manquants « En attente »',
    async () => {
      stubFetchFiche(
        ficheClient({
          statut: 'programmee',
          tournees: [
            tournee,
            {
              plaque_immatriculation: null,
              chauffeur_nom: null,
              chauffeur_telephone: null,
              type_vehicule: 'camionnette',
            },
          ],
        }),
      );
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      const bloc = await screen.findByTestId('bloc-logistique', {}, ATTENTE_UI);
      expect(bloc.textContent).toContain('Camion 1');
      expect(bloc.textContent).toContain('Camion 2');
      expect(within(bloc).getAllByText('En attente')).toHaveLength(3);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_logistique_velo_cargo_sans_plaque — vélo cargo : plaque « Sans objet », jamais « En attente »',
    async () => {
      stubFetchFiche(
        ficheClient({
          tournees: [
            {
              plaque_immatriculation: null,
              chauffeur_nom: 'Léa Martin',
              chauffeur_telephone: '+33 6 00 00 00 01',
              type_vehicule: 'velo_cargo',
            },
          ],
        }),
      );
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      await screen.findByText('Sans objet (vélo cargo)', {}, ATTENTE_UI);
      expect(screen.queryByText('En attente')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_logistique_aucun_camion — pas de tournée : « Nous affectons votre chauffeur… »',
    async () => {
      stubFetchFiche(ficheClient({ statut: 'programmee', tournees: [] }));
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      const bloc = await screen.findByTestId('bloc-logistique', {}, ATTENTE_UI);
      expect(bloc.textContent).toContain('Chauffeur pas encore affecté');
      expect(bloc.textContent).toContain(
        'Nous affectons votre chauffeur avant la collecte',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_logistique_masquee_terminee — collecte clôturée : plus de chauffeur affiché',
    async () => {
      stubFetchFiche(ficheClient({ statut: 'cloturee', tournees: [] }));
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      await screen.findByText(
        'Aucune information logistique à afficher pour cette collecte.',
        {},
        ATTENTE_UI,
      );
      expect(screen.queryByTestId('zone-urgence')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_urgence_demande — clic → POST coordonnees-urgence (sans corps) → « Demande envoyée à l’équipe Savr »',
    async () => {
      stubFetchFiche(ficheClient({ tournees: [] }));
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Demander les coordonnées en urgence' },
          ATTENTE_UI,
        ),
      );
      await screen.findByText(
        'Demande envoyée à l’équipe Savr.',
        {},
        ATTENTE_UI,
      );
      const post = urlsAppelees().find((c) =>
        c.url.endsWith('/coordonnees-urgence'),
      );
      expect(post?.url).toBe(
        '/api/v1/traiteur/collectes/c1/coordonnees-urgence',
      );
      expect(post?.method).toBe('POST');
      // Aucun texte libre n'accompagne la demande.
      const init = (
        globalThis.fetch as unknown as {
          mock: { calls: [unknown, { body?: unknown }?][] };
        }
      ).mock.calls.find(([u]) => String(u).endsWith('/coordonnees-urgence'));
      expect(init?.[1]?.body).toBeUndefined();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_urgence_deja_demandee — demande existante : confirmation affichée, plus de bouton',
    async () => {
      stubFetchFiche(
        ficheClient({ tournees: [], coordonnees_urgence_demandee: true }),
      );
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      await screen.findByText(
        'Demande envoyée à l’équipe Savr.',
        {},
        ATTENTE_UI,
      );
      expect(
        screen.queryByRole('button', {
          name: 'Demander les coordonnées en urgence',
        }),
      ).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_association_logistique_ag — AG validée : bloc Association bénéficiaire',
    async () => {
      stubFetchFiche(
        ficheClient({
          type: 'anti_gaspi',
          association: {
            nom: 'Les Restos du Cœur',
            ville: 'Paris',
            description: 'Aide alimentaire aux personnes démunies.',
          },
        }),
      );
      render(fiche('c1'));
      await ouvrirOnglet('Logistique');

      const bloc = await screen.findByTestId(
        'bloc-association',
        {},
        ATTENTE_UI,
      );
      expect(bloc.textContent).toContain('Les Restos du Cœur');
      expect(bloc.textContent).toContain('Aide alimentaire');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / pop-up — onglet Bilan & documents', () => {
  it(
    'M3.1/fiche_popup_bilan_zd_realisee — 4 KPI figés, donut, radar, « Rapport RSE » seul',
    async () => {
      stubFetchFiche(ficheClient(ZD_REALISEE));
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');

      const kpi = await screen.findByTestId('kpi-zd', {}, ATTENTE_UI);
      const t = (kpi.textContent ?? '').replace(/\s/g, ' ');
      expect(t).toContain('Poids total collecté');
      expect(t).toContain('870 kg');
      expect(t).toContain('312 kgCO₂e');
      expect(t).toContain('78,4 %');
      // 870 kg / 4 200 pax = 207 g
      expect(t).toContain('207 g');
      expect(screen.getByText('Répartition des tonnages')).toBeTruthy();
      expect(
        await screen.findByTestId('bloc-3-zd-fiche', {}, ATTENTE_UI),
      ).toBeTruthy();
      const docs = screen.getByTestId('bloc-documents');
      expect(docs.textContent).toContain('Rapport RSE');
      expect(docs.textContent).not.toMatch(/[Bb]ordereau/);
      expect(screen.queryByTestId('bilan-estompe')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_kpi_une_ligne_donut_en_ligne — valeur KPI sur une ligne (unité à part), donut et légende côte à côte',
    async () => {
      stubFetchFiche(ficheClient({ ...ZD_REALISEE, co2_net_kg: -100 }));
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');

      const kpi = await screen.findByTestId('kpi-zd', {}, ATTENTE_UI);
      // « −100 kgCO₂e » : chiffre et unité dans la même valeur insécable.
      const unite = within(kpi).getAllByText('kgCO₂e')[0]!;
      const valeur = unite.parentElement!;
      expect(valeur.className).toContain('whitespace-nowrap');
      expect(valeur.textContent?.replace(/\s/g, ' ')).toBe('-100 kgCO₂e');
      // L'unité est plus petite que le chiffre (span dédié).
      expect(unite.className).toContain('text-base');

      // Donut à gauche, légende à droite : conteneur en ligne dès 640px.
      const titre = screen.getByText('Répartition des tonnages');
      const carte = titre.closest('[class*="rounded"]')!;
      expect(carte.querySelector('.sm\\:flex-row')).not.toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it.each(['programmee', 'validee', 'realisee'])(
    'M3.1/fiche_popup_bilan_estompe_avant_realisation — blocs estompés sans valeurs + bandeau (%s)',
    async (statut) => {
      stubFetchFiche(ficheClient({ statut }));
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');

      await screen.findByText(
        'Votre bilan sera disponible après la collecte',
        {},
        ATTENTE_UI,
      );
      const estompe = screen.getByTestId('bilan-estompe');
      expect(estompe.className).toContain('opacity-40');
      expect(estompe.textContent).toContain('— kg');
      expect(screen.queryByTestId('bloc-3-zd-fiche')).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Télécharger' }),
      ).toHaveProperty('disabled', true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_bloc3_visible_zd_terminee — radar : valeur de la collecte vs repère parc',
    async () => {
      stubFetchFiche(ficheClient(ZD_REALISEE));
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');

      const bloc = await screen.findByTestId('bloc-3-zd-fiche', {}, ATTENTE_UI);
      expect(bloc.textContent).toContain(
        'Votre collecte face aux événements comparables',
      );
      expect(bloc.textContent).toContain('Biodéchets');
      expect(bloc.textContent).toContain('Déchet résiduel');
      expect(bloc.textContent).toContain('Réinitialiser');
      await waitFor(() => {
        expect(bloc.textContent).toContain('0,40');
      }, ATTENTE_UI);
      expect(bloc.textContent).toContain('+33 %');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_bloc3_filtres_initialises_sur_la_collecte — une ligne Type / Taille / Lieux, sans filtre Traiteurs, segment de la collecte',
    async () => {
      stubFetchFiche(ficheClient(ZD_REALISEE));
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');
      const bloc = await screen.findByTestId('bloc-3-zd-fiche', {}, ATTENTE_UI);

      // Titres cliquables (pas de <select> natif), pas de filtre Traiteurs même
      // si la route d'options en renvoie.
      expect(within(bloc).getByTestId('benchmark-filter-type')).toBeTruthy();
      expect(within(bloc).getByTestId('benchmark-filter-taille')).toBeTruthy();
      expect(within(bloc).getByTestId('benchmark-filter-lieux')).toBeTruthy();
      expect(
        within(bloc).queryByTestId('benchmark-filter-traiteurs'),
      ).toBeNull();
      expect(bloc.querySelector('select')).toBeNull();

      const requete = await waitFor(() => {
        const u = urlsAppelees().find((c) => c.url.includes('/benchmark?'));
        if (!u) throw new Error('aucune requête benchmark émise');
        return u.url;
      }, ATTENTE_UI);
      expect(requete).toContain('/api/v1/traiteur/collectes/c1/benchmark?');
      expect(requete).toContain('type_evenement_ids=t1');
      expect(requete).toContain('taille_evenement_codes=XL');
      expect(requete).not.toContain('traiteur_ids');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_bloc3_masque_en_ag — AG réalisée : 3 KPI + association + « Rapport de don », pas de benchmark',
    async () => {
      stubFetchFiche(
        ficheClient({
          type: 'anti_gaspi',
          statut: 'cloturee',
          repas_donnes: 840,
          co2_evite_kg: 2100,
          rapport_rse_disponible: true,
          association: {
            nom: 'Les Restos du Cœur',
            ville: 'Paris',
            description: 'Aide alimentaire.',
          },
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');

      const kpi = await screen.findByTestId('kpi-ag', {}, ATTENTE_UI);
      const t = (kpi.textContent ?? '').replace(/\s/g, ' ');
      expect(t).toContain('840 repas');
      // 840 / 4 200 = 0,20
      expect(t).toContain('0,20');
      expect(t).toContain('2 100 kgCO₂e');
      expect(screen.getByTestId('bloc-association').textContent).toContain(
        'Les Restos du Cœur',
      );
      // Q5 : renommage d'affichage.
      expect(screen.getByTestId('bloc-documents').textContent).toContain(
        'Rapport de don',
      );
      expect(screen.queryByTestId('bloc-3-zd-fiche')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_sans_excedent — bloc « Aucun repas collecté » + rapport dédié, frise « Sans excédents »',
    async () => {
      stubFetchFiche(
        ficheClient({
          type: 'anti_gaspi',
          statut: 'realisee_sans_collecte',
          aucun_repas_motif: 'Buffet entièrement consommé',
          realisee_at: '2026-10-28T21:40:00Z',
          rapport_rse_disponible: true,
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');

      const bloc = await screen.findByTestId(
        'bloc-aucun-repas',
        {},
        ATTENTE_UI,
      );
      expect(bloc.textContent).toContain('Buffet entièrement consommé');
      expect(bloc.textContent).toContain('Constaté le');
      expect(bloc.textContent).toContain('Aucune attestation de don');
      expect(screen.getByTestId('bloc-documents').textContent).toContain(
        'Rapport « Événement sans excédent alimentaire »',
      );
      expect(screen.getByTestId('frise-statut-client').textContent).toContain(
        'Sans excédents',
      );
      expect(screen.queryByTestId('bandeau-bilan-attente')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_annulee — frise « Créée · Annulée », aucun bilan ni document, pas d’actions',
    async () => {
      stubFetchFiche(
        ficheClient({
          statut: 'annulee',
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche('c1'));

      const frise = await screen.findByTestId(
        'frise-statut-client',
        {},
        ATTENTE_UI,
      );
      expect(
        within(frise)
          .getAllByRole('listitem')
          .map((li) => li.textContent?.replace(' (étape passée)', '')),
      ).toEqual(['Créée', 'Annulée']);
      await ouvrirOnglet('Bilan & documents');
      await screen.findByText(
        'Collecte annulée : aucun bilan ni document.',
        {},
        ATTENTE_UI,
      );
      expect(screen.queryByTestId('action-annuler')).toBeNull();
      expect(screen.queryByTestId('action-modifier')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_telechargement_rapport — « Télécharger » appelle la route de l’espace',
    async () => {
      const ouvrir = vi.fn();
      vi.stubGlobal('open', ouvrir);
      stubFetchFiche(ficheClient(ZD_REALISEE));
      render(fiche('c1'));
      await ouvrirOnglet('Bilan & documents');

      const docs = await screen.findByTestId('bloc-documents', {}, ATTENTE_UI);
      fireEvent.click(
        within(docs).getByRole('button', { name: 'Télécharger' }),
      );
      await waitFor(
        () =>
          expect(ouvrir).toHaveBeenCalledWith(
            'https://r2.example/rapport.pdf',
            '_blank',
          ),
        ATTENTE_UI,
      );
      expect(
        urlsAppelees().some(
          (c) => c.url === '/api/v1/traiteur/collectes/c1/rapport-rse/download',
        ),
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / pop-up — marque blanche et actions', () => {
  it.each([
    ['ZD à venir', { statut: 'validee' }],
    ['ZD réalisée', ZD_REALISEE],
    [
      'AG sans excédents',
      {
        type: 'anti_gaspi',
        statut: 'realisee_sans_collecte',
        actions: { modifier: 'absent', annuler: 'absent', annulation: null },
      },
    ],
  ] as const)(
    'M3.1/fiche_popup_aucun_mot_transporteur — ni « transporteur » ni « prestataire » (%s)',
    async (_cas, over) => {
      stubFetchFiche(
        ficheClient({
          ...(over as object),
          tournees: [
            {
              plaque_immatriculation: null,
              chauffeur_nom: 'Jean',
              chauffeur_telephone: null,
              type_vehicule: 'camionnette',
            },
          ],
        }),
      );
      render(fiche('c1'));

      const texte = await texteDesTroisOnglets();
      expect(texte).not.toMatch(/transporteur|prestataire/i);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_sous_modales_marque_blanche — annulation directe : aucun « prestataire »',
    async () => {
      stubFetchFiche(
        ficheClient({
          statut: 'programmee',
          actions: {
            modifier: 'actif',
            annuler: 'actif',
            annulation: 'directe',
          },
        }),
      );
      render(fiche('c1'));
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Annuler la collecte' },
          ATTENTE_UI,
        ),
      );
      await screen.findByRole(
        'button',
        { name: 'Confirmer l’annulation' },
        ATTENTE_UI,
      );
      expect(document.body.textContent).not.toMatch(
        /prestataire|transporteur/i,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_pied_actions — « Demander l’annulation » puis « Modifier la collecte » ; grisés sans le droit',
    async () => {
      stubFetchFiche(ficheClient());
      const { unmount } = render(fiche('c1'));
      const annuler = await screen.findByTestId(
        'action-annuler',
        {},
        ATTENTE_UI,
      );
      const modifier = screen.getByTestId('action-modifier');
      expect(annuler.textContent).toContain('Demander l’annulation');
      expect(modifier.textContent).toContain('Modifier la collecte');
      // Ordre : annulation avant modification (maquette validée).
      expect(
        annuler.compareDocumentPosition(modifier) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(annuler).toHaveProperty('disabled', false);
      unmount();

      // Commercial sur la collecte d'un autre (§06.04) : grisés.
      stubFetchFiche(
        ficheClient({
          actions: {
            modifier: 'grise',
            annuler: 'grise',
            annulation: 'demande',
          },
        }),
      );
      render(fiche('c1'));
      expect(
        await screen.findByTestId('action-annuler', {}, ATTENTE_UI),
      ).toHaveProperty('disabled', true);
      expect(screen.getByTestId('action-modifier')).toHaveProperty(
        'disabled',
        true,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_edition_sans_notes_internes — le formulaire d’édition n’expose plus les notes Admin (C1)',
    async () => {
      stubFetchFiche(ficheClient({ statut: 'programmee' }));
      render(fiche('c1'));
      fireEvent.click(
        await screen.findByTestId('action-modifier', {}, ATTENTE_UI),
      );
      await screen.findByRole(
        'button',
        { name: 'Confirmer la modification' },
        ATTENTE_UI,
      );
      expect(screen.queryByLabelText('Notes internes')).toBeNull();
      expect(
        screen.getByLabelText('Informations supplémentaires'),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.1 / pop-up — Échap', () => {
  it(
    'M3.1/fiche_ui_echap_confirmation_edition_garde_la_fiche — Échap ferme la confirmation, pas la fiche',
    async () => {
      // Créneau passé (< 12h) → la confirmation « urgence » s'ouvre.
      stubFetchFiche(
        ficheClient({ statut: 'programmee', date_collecte: '2020-01-01' }),
      );
      const onClose = vi.fn();
      render(
        <FicheCollecteClientModal
          espace="traiteur"
          collecteId="c1"
          initialEditing
          onClose={onClose}
        />,
      );
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Confirmer la modification' },
          ATTENTE_UI,
        ),
      );
      await waitFor(
        () => expect(screen.getAllByRole('dialog')).toHaveLength(2),
        ATTENTE_UI,
      );

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(
        () => expect(screen.getAllByRole('dialog')).toHaveLength(1),
        ATTENTE_UI,
      );
      expect(onClose).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_popup_echap_annulation_garde_la_fiche — Échap sur la sous-modale d’annulation ne ferme qu’elle',
    async () => {
      stubFetchFiche(ficheClient());
      const onClose = vi.fn();
      render(fiche('c1', onClose));
      fireEvent.click(
        await screen.findByTestId('action-annuler', {}, ATTENTE_UI),
      );
      await waitFor(
        () => expect(screen.getAllByRole('dialog')).toHaveLength(2),
        ATTENTE_UI,
      );
      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(
        () => expect(screen.getAllByRole('dialog')).toHaveLength(1),
        ATTENTE_UI,
      );
      expect(onClose).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.1/fiche_ui_echap_sans_sous_modale_ferme_la_fiche — contre-épreuve de la garde',
    async () => {
      stubFetchFiche(ficheClient());
      const onClose = vi.fn();
      render(fiche('c1', onClose));
      await screen.findByText('Cocktail apéritif', {}, ATTENTE_UI);

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    },
    ATTENTE_CAS_MS,
  );
});
