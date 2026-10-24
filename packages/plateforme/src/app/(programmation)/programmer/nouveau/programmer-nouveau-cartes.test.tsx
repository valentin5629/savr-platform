/**
 * M1.2 — formulaire de programmation en deux écrans (refonte, lot B2 ;
 * décisions Val 2026-10-22, C1–C8, et 2026-10-24, B2-Q1 à B2-Q4) :
 *   · écran 1 « Informations sur l'événement » : nom, lieu, nombre de collectes
 *     par type (au plus 10 de chaque), « Continuer » seul (pas de brouillon) ;
 *   · écran 2 « Informations sur les collectes » : une carte par collecte, qui
 *     reprend la collecte n°1 champ par champ tant qu'on ne la modifie pas (C5),
 *     avertissement « une seule collecte suffit » sur deux collectes du même type
 *     à la même date et à la même heure (C4), « Ajouter une collecte »,
 *     « Enregistrer en brouillon » et « Confirmer » ;
 *   · un brouillon se rouvre dans le formulaire complet, modifiable, et
 *     s'enregistre par PUT …/brouillon (B2-Q2).
 *
 * Les sélecteurs de date et d'heure (fenêtres surgissantes) sont remplacés par
 * des champs texte : ces tests portent sur le formulaire, pas sur les
 * calendriers. Les listes (lieu, type d'événement, contacts, traiteur) sont les
 * vraies, alimentées par le `fetch` simulé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, back: vi.fn(), refresh: vi.fn() }),
  // Page de reprise : /programmer/brouillon/evt-b.
  useParams: () => ({ id: 'evt-b' }),
}));

interface ChampTexteProps {
  id?: string;
  'data-testid'?: string;
  value?: string;
  onChange?: (v: string) => void;
}
vi.mock('@/components/ui/date-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DatePicker: (p: ChampTexteProps) => (
    <input
      id={p.id}
      data-testid={p['data-testid']}
      value={p.value ?? ''}
      onChange={(e) => p.onChange?.(e.target.value)}
    />
  ),
}));
vi.mock('@/components/ui/time-picker', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  TimePicker: (p: ChampTexteProps) => (
    <input
      id={p.id}
      data-testid={p['data-testid']}
      value={p.value ?? ''}
      onChange={(e) => p.onChange?.(e.target.value)}
    />
  ),
}));

const session = vi.hoisted(() => ({ role: 'traiteur_manager' }));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getSession: () => {
        const b64url = (o: unknown) =>
          Buffer.from(JSON.stringify(o)).toString('base64url');
        const jeton = `${b64url({ alg: 'HS256' })}.${b64url({
          user_role: session.role,
        })}.sig`;
        return Promise.resolve({ data: { session: { access_token: jeton } } });
      },
    },
  }),
}));

import NouveauProgrammationPage from './page';
import RepriseBrouillonPage from '../brouillon/[id]/page';

const ECRAN_1 = "Informations sur l'événement";
const ECRAN_2 = 'Informations sur les collectes';
const DOUBLON =
  "Pour un gros volume, une seule collecte suffit : l'équipe Savr fixe le nombre de camions.";
const T_COCKTAIL = '0b4c2f7e-1111-4aaa-9bbb-000000000001';
const T_DINER = '0b4c2f7e-1111-4aaa-9bbb-000000000002';
const LIEU = {
  id: 'lieu-1',
  nom: 'Musée des Arts Forains',
  adresse_acces: '53 avenue des Terroirs de France',
  code_postal: '75012',
  ville: 'Paris',
  controle_acces_requis_default: false,
};
const PAUL = {
  id: 'c-paul',
  prenom: 'Paul',
  nom: 'Arnaud',
  telephone: '06 12 34 56 78',
};
const LEA = {
  id: 'c-lea',
  prenom: 'Léa',
  nom: 'Martin',
  telephone: '07 11 22 33 44',
};

interface Simulation {
  /** Événement rendu par GET /api/v1/programmation/evenements/evt-b. */
  brouillon?: object | null;
  traiteurs?: object[];
}

/** `fetch` simulé des routes appelées par le formulaire. */
function installerFetch({ brouillon, traiteurs = [] }: Simulation = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const methode = init?.method ?? 'GET';
    const json = (corps: unknown, ok = true) =>
      Promise.resolve({
        ok,
        status: ok ? 200 : 404,
        json: () => Promise.resolve(corps),
      } as Response);
    if (url.includes('/programmation/types-evenements')) {
      return json([
        { id: T_COCKTAIL, libelle: 'Cocktail' },
        { id: T_DINER, libelle: 'Dîner assis' },
      ]);
    }
    if (url.includes('/programmation/lieux')) return json([LIEU]);
    if (url.includes('/programmation/contacts') && methode === 'GET') {
      return json([PAUL, LEA]);
    }
    if (url.includes('/programmation/pack-ag')) {
      return json({
        pack_actif: true,
        credits_initiaux: 10,
        credits_restants: 6,
      });
    }
    if (url.includes('/programmation/organisations/traiteurs')) {
      return json(traiteurs);
    }
    if (url === '/api/v1/programmation/evenements' && methode === 'POST') {
      return json({ evenement_id: 'evt-1', collecte_ids: [] });
    }
    if (url === '/api/v1/programmation/evenements/evt-b/brouillon') {
      return json({ evenement_id: 'evt-b', collecte_ids: [] });
    }
    if (url === '/api/v1/programmation/evenements/evt-b') {
      return brouillon
        ? json(brouillon)
        : json({ error: 'introuvable' }, false);
    }
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Corps JSON des appels `methode` vers `url`. */
function envois(
  fetchMock: ReturnType<typeof installerFetch>,
  url: string,
  methode: string,
): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(([u, init]) => String(u) === url && init?.method === methode)
    .map(
      ([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>,
    );
}

// ── Écran 1 ──────────────────────────────────────────────────────────────────

const continuer = () => screen.getByRole('button', { name: /Continuer/ });
const champNombre = (type: 'zd' | 'ag') =>
  document.getElementById(`nombre-${type}`) as HTMLInputElement;
const demander = (type: 'zd' | 'ag', n: number | string) =>
  fireEvent.change(champNombre(type), { target: { value: String(n) } });
const nomEvenement = () => screen.getByLabelText(/^Nom de l'événement/);

/**
 * Ouvre une liste (Popover Radix), clique l'option, puis attend que le focus
 * soit revenu au déclencheur : Radix l'y rend une tâche plus tard, et s'il
 * arrive pendant qu'une autre liste est ouverte, celle-ci se referme (focus
 * « hors » de la liste). Un utilisateur ne va jamais aussi vite.
 */
async function choisirOption(
  declencheur: HTMLElement,
  option: string | RegExp,
) {
  fireEvent.click(declencheur);
  fireEvent.click(
    await screen.findByRole('option', { name: option }, ATTENTE_UI),
  );
  await waitFor(() => expect(declencheur).toHaveFocus(), ATTENTE_UI);
}

async function choisirLieu() {
  await choisirOption(
    screen.getByText('Rechercher un lieu…').closest('button')!,
    /Musée des Arts Forains/,
  );
}

/** Écran 1 rempli (nom, lieu, nombre de collectes), puis écran 2. */
async function jusquaEcran2(zd: number, ag = 0) {
  await screen.findByRole('heading', { level: 2, name: ECRAN_1 }, ATTENTE_UI);
  fireEvent.change(nomEvenement(), { target: { value: 'Gala de printemps' } });
  await choisirLieu();
  demander('zd', zd);
  demander('ag', ag);
  fireEvent.click(continuer());
  await screen.findByRole('heading', { level: 2, name: ECRAN_2 }, ATTENTE_UI);
}

// ── Écran 2 : cartes ─────────────────────────────────────────────────────────

const carte = (suffixe: string) => screen.getByTestId(`carte-${suffixe}`);
const suffixesCartes = () =>
  screen
    .queryAllByTestId(/^carte-(zd|ag)-\d+$/)
    .map((c) => c.getAttribute('data-testid')!.slice('carte-'.length));

/** Bloc d'un champ de la carte (libellé + champ), repéré par son libellé. */
function zone(suffixe: string, libelle: RegExp): HTMLElement {
  return within(carte(suffixe)).getByText(libelle, { selector: 'label' })
    .parentElement!;
}
const zoneContact = (suffixe: string, role: 'principal' | 'secours') =>
  zone(
    suffixe,
    role === 'principal'
      ? /^Contact principal sur place/
      : /^Contact de secours/,
  );
const contactAffiche = (suffixe: string, role: 'principal' | 'secours') =>
  within(zoneContact(suffixe, role)).getByRole('button');
const typeAffiche = (suffixe: string) =>
  within(carte(suffixe)).getByRole('combobox', { name: /Type d'événement/ });
const champCarte = (champ: 'date' | 'heure' | 'pax', suffixe: string) =>
  screen.getByTestId(`${champ}-${suffixe}`) as HTMLInputElement;
const infos = (suffixe: string) =>
  document.getElementById(`infos-${suffixe}`) as HTMLTextAreaElement;

function saisir(
  champ: 'date' | 'heure' | 'pax',
  suffixe: string,
  valeur: string,
) {
  fireEvent.change(champCarte(champ, suffixe), { target: { value: valeur } });
}

async function choisirType(suffixe: string, libelle: string) {
  await choisirOption(typeAffiche(suffixe), libelle);
}

async function choisirContact(
  suffixe: string,
  role: 'principal' | 'secours',
  nom: 'Paul Arnaud' | 'Léa Martin',
) {
  await choisirOption(contactAffiche(suffixe, role), new RegExp(nom));
}

/** Carte entièrement saisie : date, heure, convives, type, contact, infos. */
async function remplirCarte(
  suffixe: string,
  v: { date: string; heure: string; pax?: string; infos?: string },
) {
  saisir('date', suffixe, v.date);
  saisir('heure', suffixe, v.heure);
  if (v.pax !== undefined) saisir('pax', suffixe, v.pax);
  await choisirType(suffixe, 'Cocktail');
  await choisirContact(suffixe, 'principal', 'Paul Arnaud');
  if (v.infos !== undefined) {
    fireEvent.change(infos(suffixe), { target: { value: v.infos } });
  }
}

beforeEach(() => {
  session.role = 'traiteur_manager';
  nav.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('M1.2 / formulaire de programmation en deux écrans (lot B2)', () => {
  it(
    'M1.2/formulaire_deux_ecrans — écran 1 sans brouillon ; « Continuer » attend nom, lieu et une collecte ; une carte par collecte demandée, 10 au plus par type',
    async () => {
      installerFetch();
      render(<NouveauProgrammationPage />);
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_1 },
        ATTENTE_UI,
      );

      // Écran 1 : « Continuer » seul, ni brouillon ni confirmation (B2-Q1).
      expect(
        screen.queryByRole('button', { name: /Enregistrer en brouillon/ }),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: /Confirmer/ })).toBeNull();
      expect(continuer()).toBeDisabled();

      // Nom seul : il manque le lieu et une collecte.
      fireEvent.change(nomEvenement(), { target: { value: 'Gala' } });
      expect(continuer()).toBeDisabled();
      // Nom et collectes, sans lieu.
      demander('zd', 2);
      demander('ag', 1);
      expect(continuer()).toBeDisabled();
      // Nom, lieu et collectes : l'écran 1 est complet.
      await choisirLieu();
      expect(continuer()).toBeEnabled();
      // Aucune collecte.
      demander('zd', 0);
      demander('ag', 0);
      expect(continuer()).toBeDisabled();
      // Nom fait d'espaces.
      demander('zd', 2);
      demander('ag', 1);
      fireEvent.change(nomEvenement(), { target: { value: '   ' } });
      expect(continuer()).toBeDisabled();
      fireEvent.change(nomEvenement(), { target: { value: 'Gala' } });
      expect(continuer()).toBeEnabled();

      // Au plus 10 collectes de chaque type (B2-Q4).
      expect(champNombre('zd')).toHaveAttribute('max', '10');
      expect(champNombre('ag')).toHaveAttribute('max', '10');
      demander('zd', 12);
      expect(champNombre('zd')).toHaveValue(10);
      demander('zd', 2);
      expect(champNombre('zd')).toHaveValue(2);

      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      // Une carte par collecte demandée, numérotée par type.
      expect(suffixesCartes()).toEqual(['zd-1', 'zd-2', 'ag-1']);
      expect(
        screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
      ).toEqual([
        'Collecte Zéro Déchet #1',
        'Collecte Zéro Déchet #2',
        'Collecte Anti-Gaspi #1',
      ]);
      // Écran 2 : brouillon et confirmation, plus « Continuer ».
      expect(
        screen.getByRole('button', { name: /Enregistrer en brouillon/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Confirmer les programmations/ }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Continuer/ })).toBeNull();

      // Retour : l'écran 1 garde sa saisie ; 10 de chaque type = 20 cartes.
      fireEvent.click(screen.getByRole('button', { name: /Retour/ }));
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_1 },
        ATTENTE_UI,
      );
      expect(nomEvenement()).toHaveValue('Gala');
      expect(champNombre('zd')).toHaveValue(2);
      expect(champNombre('ag')).toHaveValue(1);
      demander('zd', 10);
      demander('ag', 10);
      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      const suffixes = suffixesCartes();
      expect(suffixes).toHaveLength(20);
      expect(suffixes).toContain('zd-10');
      expect(suffixes).toContain('ag-10');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_nombre_vide — un nombre de collectes s’efface au clavier : le champ vide vaut 0, les cartes ne sont retirées qu’en quittant le champ',
    async () => {
      installerFetch();
      render(<NouveauProgrammationPage />);
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_1 },
        ATTENTE_UI,
      );
      fireEvent.change(nomEvenement(), { target: { value: 'Gala' } });
      await choisirLieu();

      // Effacé au clavier : le champ reste vide et vaut 0 collecte.
      demander('zd', 1);
      expect(continuer()).toBeEnabled();
      demander('zd', '');
      expect(champNombre('zd')).toHaveValue(null);
      expect(continuer()).toBeDisabled();
      // En quittant le champ, il affiche 0.
      fireEvent.blur(champNombre('zd'));
      expect(champNombre('zd')).toHaveValue(0);
      expect(continuer()).toBeDisabled();
      // « 0 » se tape aussi.
      demander('zd', 2);
      demander('zd', 0);
      expect(champNombre('zd')).toHaveValue(0);
      expect(continuer()).toBeDisabled();

      // Effacer « 1 » pour taper « 3 » garde ce qui a été saisi dans les
      // cartes.
      demander('zd', 1);
      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      saisir('pax', 'zd-1', '80');
      fireEvent.change(infos('zd-1'), { target: { value: 'Quai n°4' } });
      fireEvent.click(screen.getByRole('button', { name: /Retour/ }));
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_1 },
        ATTENTE_UI,
      );
      demander('zd', '');
      demander('zd', 3);
      fireEvent.blur(champNombre('zd'));
      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      expect(suffixesCartes()).toEqual(['zd-1', 'zd-2', 'zd-3']);
      expect(champCarte('pax', 'zd-1')).toHaveValue(80);
      expect(infos('zd-1')).toHaveValue('Quai n°4');

      // Effacé puis quitté : les cartes de ce type sont retirées.
      fireEvent.click(screen.getByRole('button', { name: /Retour/ }));
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_1 },
        ATTENTE_UI,
      );
      demander('ag', 1);
      demander('zd', '');
      fireEvent.blur(champNombre('zd'));
      expect(champNombre('zd')).toHaveValue(0);
      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      expect(suffixesCartes()).toEqual(['ag-1']);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_suivi_collecte_1 — les cartes reprennent la collecte n°1 champ par champ ; un champ modifié dans une carte n’en bouge plus',
    async () => {
      installerFetch();
      render(<NouveauProgrammationPage />);
      await jusquaEcran2(2, 1);

      // Seules les cartes suivantes portent le rappel de la reprise.
      const RAPPEL = /reprennent ceux de la collecte n°1/;
      expect(within(carte('zd-1')).queryByText(RAPPEL)).toBeNull();
      expect(within(carte('zd-2')).getByText(RAPPEL)).toBeInTheDocument();
      expect(within(carte('ag-1')).getByText(RAPPEL)).toBeInTheDocument();

      await remplirCarte('zd-1', {
        date: '2030-01-15',
        heure: '22:00',
        pax: '120',
        infos: 'Quai n°2',
      });

      // Convives, type d'événement, contact et informations repris ; date et
      // heure jamais.
      for (const suffixe of ['zd-2', 'ag-1']) {
        expect(champCarte('pax', suffixe)).toHaveValue(120);
        expect(typeAffiche(suffixe)).toHaveTextContent('Cocktail');
        expect(contactAffiche(suffixe, 'principal')).toHaveTextContent(
          'Paul Arnaud — 06 12 34 56 78',
        );
        expect(infos(suffixe)).toHaveValue('Quai n°2');
        expect(champCarte('date', suffixe)).toHaveValue('');
        expect(champCarte('heure', suffixe)).toHaveValue('');
      }

      // Modifiés dans la carte n°2 : ses convives et son contact.
      saisir('pax', 'zd-2', '60');
      await choisirContact('zd-2', 'principal', 'Léa Martin');
      expect(champCarte('pax', 'zd-1')).toHaveValue(120);
      expect(contactAffiche('zd-1', 'principal')).toHaveTextContent(
        'Paul Arnaud',
      );

      // La collecte n°1 change ensuite.
      saisir('pax', 'zd-1', '150');
      await choisirType('zd-1', 'Dîner assis');
      fireEvent.change(infos('zd-1'), { target: { value: 'Quai n°3' } });

      // Carte n°2 : ses champs modifiés restent, les autres suivent encore.
      expect(champCarte('pax', 'zd-2')).toHaveValue(60);
      expect(contactAffiche('zd-2', 'principal')).toHaveTextContent(
        'Léa Martin — 07 11 22 33 44',
      );
      expect(typeAffiche('zd-2')).toHaveTextContent('Dîner assis');
      expect(infos('zd-2')).toHaveValue('Quai n°3');
      // Carte Anti-Gaspi jamais modifiée : tout suit.
      expect(champCarte('pax', 'ag-1')).toHaveValue(150);
      expect(contactAffiche('ag-1', 'principal')).toHaveTextContent(
        'Paul Arnaud',
      );
      expect(typeAffiche('ag-1')).toHaveTextContent('Dîner assis');
      expect(infos('ag-1')).toHaveValue('Quai n°3');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_doublon_meme_heure — avertissement sur deux collectes du même type à la même date et à la même heure, non bloquant ; aucun si l’heure ou la date diffère',
    async () => {
      installerFetch();
      render(<NouveauProgrammationPage />);
      await jusquaEcran2(2, 1);
      await remplirCarte('zd-1', {
        date: '2030-01-15',
        heure: '22:00',
        pax: '120',
      });
      expect(screen.queryByText(DOUBLON)).toBeNull();

      // Deuxième ZD, même date, même heure : les deux cartes ZD sont averties.
      saisir('date', 'zd-2', '2030-01-15');
      saisir('heure', 'zd-2', '22:00');
      expect(within(carte('zd-1')).getByText(DOUBLON)).toBeInTheDocument();
      expect(within(carte('zd-2')).getByText(DOUBLON)).toBeInTheDocument();

      // Une AG au même créneau : autre type, aucun avertissement pour elle.
      saisir('date', 'ag-1', '2030-01-15');
      saisir('heure', 'ag-1', '22:00');
      expect(within(carte('ag-1')).queryByText(DOUBLON)).toBeNull();
      expect(screen.getAllByText(DOUBLON)).toHaveLength(2);

      // Non bloquant : toutes les cartes complètes, la confirmation part.
      expect(
        screen.getByRole('button', { name: /Confirmer les programmations/ }),
      ).toBeEnabled();
      expect(
        screen.getByRole('button', { name: /Enregistrer en brouillon/ }),
      ).toBeEnabled();

      // Heure différente : plus d'avertissement.
      saisir('heure', 'zd-2', '23:00');
      expect(screen.queryByText(DOUBLON)).toBeNull();
      // Même heure, autre date : aucun non plus.
      saisir('heure', 'zd-2', '22:00');
      saisir('date', 'zd-2', '2030-01-16');
      expect(screen.queryByText(DOUBLON)).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_ajouter_collecte — « Ajouter une collecte » (écran 2) : choix du type, la carte ajoutée suit la collecte n°1 ; 10 au plus par type',
    async () => {
      installerFetch();
      render(<NouveauProgrammationPage />);
      await jusquaEcran2(1);
      await remplirCarte('zd-1', {
        date: '2030-01-15',
        heure: '22:00',
        pax: '120',
        infos: 'Quai n°2',
      });

      const ajouter = () =>
        screen.getByRole('button', { name: /Ajouter une collecte/ });
      // Le choix du type s'ouvre, et s'annule sans rien ajouter.
      fireEvent.click(ajouter());
      expect(screen.getByText('Type de la collecte à ajouter :')).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: /Ajouter une collecte/ }),
      ).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
      expect(suffixesCartes()).toEqual(['zd-1']);

      // Anti-Gaspi : une carte de plus, qui reprend la collecte n°1.
      fireEvent.click(ajouter());
      fireEvent.click(screen.getByRole('button', { name: 'Anti-Gaspi (AG)' }));
      expect(suffixesCartes()).toEqual(['zd-1', 'ag-1']);
      expect(
        within(carte('ag-1')).getByRole('heading', { level: 3 }),
      ).toHaveTextContent('Collecte Anti-Gaspi #1');
      expect(champCarte('pax', 'ag-1')).toHaveValue(120);
      expect(typeAffiche('ag-1')).toHaveTextContent('Cocktail');
      expect(contactAffiche('ag-1', 'principal')).toHaveTextContent(
        'Paul Arnaud',
      );
      expect(infos('ag-1')).toHaveValue('Quai n°2');
      expect(champCarte('date', 'ag-1')).toHaveValue('');
      expect(champCarte('heure', 'ag-1')).toHaveValue('');
      // Elle continue de suivre la collecte n°1.
      saisir('pax', 'zd-1', '90');
      expect(champCarte('pax', 'ag-1')).toHaveValue(90);
      // Le choix se referme ; le bouton revient.
      expect(ajouter()).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Confirmer les programmations/ }),
      ).toBeInTheDocument();

      // Retour : l'écran 1 compte la collecte ajoutée.
      fireEvent.click(screen.getByRole('button', { name: /Retour/ }));
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_1 },
        ATTENTE_UI,
      );
      expect(champNombre('zd')).toHaveValue(1);
      expect(champNombre('ag')).toHaveValue(1);

      // 10 ZD : le choix Zéro Déchet est fermé, Anti-Gaspi reste possible.
      demander('zd', 10);
      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      fireEvent.click(ajouter());
      expect(
        screen.getByRole('button', { name: 'Zéro Déchet (ZD)' }),
      ).toBeDisabled();
      const choixAg = screen.getByRole('button', { name: 'Anti-Gaspi (AG)' });
      expect(choixAg).toBeEnabled();
      fireEvent.click(choixAg);
      expect(suffixesCartes().filter((s) => s.startsWith('zd-'))).toHaveLength(
        10,
      );
      expect(suffixesCartes()).toContain('ag-2');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_corps_envoye — confirmer : une carte par collecte avec son type d’événement et ses contacts ; libellé singulier ou pluriel',
    async () => {
      const fetchMock = installerFetch();
      render(<NouveauProgrammationPage />);
      await jusquaEcran2(1);

      // Une collecte : libellé au singulier ; rien ne part tant que la carte
      // n'est pas complète.
      const confirmerUne = screen.getByRole('button', {
        name: 'Confirmer la programmation',
      });
      expect(confirmerUne).toBeDisabled();
      await remplirCarte('zd-1', {
        date: '2030-01-15',
        heure: '22:00',
        pax: '120',
        infos: 'Quai n°2',
      });
      expect(confirmerUne).toBeEnabled();

      // Deux collectes : libellé au pluriel. La carte AG a son propre contact
      // principal et un contact de secours ; le reste suit la ZD #1.
      fireEvent.click(
        screen.getByRole('button', { name: /Ajouter une collecte/ }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Anti-Gaspi (AG)' }));
      const confirmer = screen.getByRole('button', {
        name: 'Confirmer les programmations',
      });
      expect(confirmer).toBeDisabled();
      saisir('date', 'ag-1', '2030-01-16');
      saisir('heure', 'ag-1', '08:00');
      await choisirContact('ag-1', 'principal', 'Léa Martin');
      await choisirContact('ag-1', 'secours', 'Paul Arnaud');
      expect(confirmer).toBeEnabled();
      fireEvent.click(confirmer);

      await waitFor(
        () => expect(nav.push).toHaveBeenCalledTimes(1),
        ATTENTE_UI,
      );
      expect(nav.push).toHaveBeenCalledWith(
        '/programmer/confirmation?id=evt-1',
      );
      const [corps, ...autres] = envois(
        fetchMock,
        '/api/v1/programmation/evenements',
        'POST',
      );
      expect(autres).toEqual([]);
      expect(corps).toMatchObject({
        nom_evenement: 'Gala de printemps',
        lieu_id: 'lieu-1',
        controle_acces_requis: false,
        confirmer: true,
      });
      expect(corps!.collectes).toEqual([
        {
          type: 'zd',
          date_collecte: '2030-01-15',
          heure_collecte: '22:00',
          pax: 120,
          type_evenement_id: T_COCKTAIL,
          contact_principal_nom: 'Paul Arnaud',
          contact_principal_telephone: '06 12 34 56 78',
          contact_secours_nom: null,
          contact_secours_telephone: null,
          informations_supplementaires: 'Quai n°2',
        },
        {
          type: 'ag',
          date_collecte: '2030-01-16',
          heure_collecte: '08:00',
          pax: 120,
          type_evenement_id: T_COCKTAIL,
          contact_principal_nom: 'Léa Martin',
          contact_principal_telephone: '07 11 22 33 44',
          contact_secours_nom: 'Paul Arnaud',
          contact_secours_telephone: '06 12 34 56 78',
          informations_supplementaires: 'Quai n°2',
        },
      ]);
      // Rien au niveau de l'événement : ni convives, ni type, ni contacts ; un
      // traiteur ne désigne aucune organisation.
      for (const champ of [
        'pax',
        'type_evenement_id',
        'contact_principal_nom',
        'contact_principal_telephone',
        'contact_secours_nom',
        'contact_secours_telephone',
        'organisation_id',
        'traiteur_operationnel_organisation_id',
      ]) {
        expect(corps).not.toHaveProperty(champ);
      }
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_corps_envoye — « Enregistrer en brouillon » (écran 2) : mêmes champs obligatoires, confirmer: false, retour aux brouillons',
    async () => {
      const fetchMock = installerFetch();
      render(<NouveauProgrammationPage />);
      await jusquaEcran2(1);
      const brouillon = screen.getByRole('button', {
        name: /Enregistrer en brouillon/,
      });

      // Mêmes champs obligatoires que la confirmation : sans date, rien ne part.
      saisir('heure', 'zd-1', '22:00');
      saisir('pax', 'zd-1', '120');
      await choisirType('zd-1', 'Cocktail');
      await choisirContact('zd-1', 'principal', 'Paul Arnaud');
      expect(brouillon).toBeDisabled();
      saisir('date', 'zd-1', '2030-01-15');
      expect(brouillon).toBeEnabled();
      fireEvent.click(brouillon);

      await waitFor(
        () => expect(nav.push).toHaveBeenCalledWith('/brouillons'),
        ATTENTE_UI,
      );
      const corps = envois(
        fetchMock,
        '/api/v1/programmation/evenements',
        'POST',
      );
      expect(corps).toHaveLength(1);
      expect(corps[0]).toMatchObject({
        nom_evenement: 'Gala de printemps',
        lieu_id: 'lieu-1',
        confirmer: false,
        collectes: [
          expect.objectContaining({
            type: 'zd',
            date_collecte: '2030-01-15',
            type_evenement_id: T_COCKTAIL,
            contact_principal_nom: 'Paul Arnaud',
          }),
        ],
      });
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/brouillon')),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );
});

// ── Reprise d'un brouillon (B2-Q2) ───────────────────────────────────────────

const CONTACTS_PAUL_LEA = {
  contact_principal_nom: 'Paul Arnaud',
  contact_principal_telephone: '06 12 34 56 78',
  contact_secours_nom: 'Léa Martin',
  contact_secours_telephone: '07 11 22 33 44',
};
/** Brouillon relu par GET …/evenements/evt-b (AG rendue avant la ZD). */
const BROUILLON = {
  id: 'evt-b',
  organisation_id: 'org-traiteur',
  lieu_id: 'lieu-1',
  nom_evenement: 'Gala repris',
  nom_client_organisateur: 'Maison Dupont',
  reference_affaire: 'CMD-42',
  controle_acces_requis: true,
  traiteur_operationnel: null,
  lieux: {
    nom: 'Musée des Arts Forains',
    adresse_acces: '53 avenue des Terroirs de France',
    code_postal: '75012',
    ville: 'Paris',
    acces_details: null,
    controle_acces_requis_default: false,
  },
  collectes: [
    {
      type: 'anti_gaspi',
      statut: 'brouillon',
      date_collecte: '2030-01-16',
      heure_collecte: '08:00:00',
      pax: 40,
      type_evenement_id: T_COCKTAIL,
      informations_supplementaires: null,
      lieu_overrides: { adresse_acces: 'Quai 3' },
      contacts: {
        contact_principal_nom: 'Léa Martin',
        contact_principal_telephone: '07 11 22 33 44',
        contact_secours_nom: null,
        contact_secours_telephone: null,
      },
    },
    {
      type: 'zero_dechet',
      statut: 'brouillon',
      date_collecte: '2030-01-15',
      heure_collecte: '22:00:00',
      pax: 120,
      type_evenement_id: T_COCKTAIL,
      informations_supplementaires: 'Quai n°2',
      lieu_overrides: { adresse_acces: 'Quai 3' },
      contacts: CONTACTS_PAUL_LEA,
    },
  ],
};

describe('M1.2 / reprise d’un brouillon dans le formulaire complet (lot B2)', () => {
  it(
    'M1.2/formulaire_reprise_brouillon — écrans pré-remplis depuis le GET, cartes avec leurs contacts et leur type, enregistrement en PUT …/brouillon',
    async () => {
      const fetchMock = installerFetch({ brouillon: BROUILLON });
      render(<RepriseBrouillonPage />);

      // Écran 1 : l'événement du brouillon.
      await waitFor(
        () => expect(nomEvenement()).toHaveValue('Gala repris'),
        ATTENTE_UI,
      );
      expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain(
        '/api/v1/programmation/evenements/evt-b',
      );
      expect(screen.getByLabelText('Client final (optionnel)')).toHaveValue(
        'Maison Dupont',
      );
      expect(
        screen.getByLabelText('Référence interne (optionnel)'),
      ).toHaveValue('CMD-42');
      expect(
        screen.getByText('Musée des Arts Forains — Paris'),
      ).toBeInTheDocument();
      // Surcharge du lieu reprise de la collecte.
      expect(screen.getByLabelText("Adresse d'accès livraison")).toHaveValue(
        'Quai 3',
      );
      expect(
        screen.getByRole('checkbox', { name: /Plaque d'immatriculation/ }),
      ).toBeChecked();
      expect(champNombre('zd')).toHaveValue(1);
      expect(champNombre('ag')).toHaveValue(1);
      expect(
        screen.queryByRole('button', { name: /Enregistrer en brouillon/ }),
      ).toBeNull();
      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );

      // Écran 2 : une carte par collecte, chacune avec ses valeurs.
      expect(suffixesCartes()).toEqual(['zd-1', 'ag-1']);
      expect(champCarte('date', 'zd-1')).toHaveValue('2030-01-15');
      expect(champCarte('heure', 'zd-1')).toHaveValue('22:00');
      expect(champCarte('pax', 'zd-1')).toHaveValue(120);
      expect(typeAffiche('zd-1')).toHaveTextContent('Cocktail');
      expect(contactAffiche('zd-1', 'principal')).toHaveTextContent(
        'Paul Arnaud — 06 12 34 56 78',
      );
      expect(contactAffiche('zd-1', 'secours')).toHaveTextContent(
        'Léa Martin — 07 11 22 33 44',
      );
      expect(infos('zd-1')).toHaveValue('Quai n°2');
      expect(champCarte('date', 'ag-1')).toHaveValue('2030-01-16');
      expect(champCarte('heure', 'ag-1')).toHaveValue('08:00');
      expect(champCarte('pax', 'ag-1')).toHaveValue(40);
      expect(typeAffiche('ag-1')).toHaveTextContent('Cocktail');
      expect(contactAffiche('ag-1', 'principal')).toHaveTextContent(
        'Léa Martin — 07 11 22 33 44',
      );
      expect(contactAffiche('ag-1', 'secours')).toHaveTextContent(
        'Ajouter un contact de secours…',
      );
      expect(infos('ag-1')).toHaveValue('');

      // Champs égaux à la collecte n°1 : repris ; différents : gardés.
      await choisirType('zd-1', 'Dîner assis');
      expect(typeAffiche('ag-1')).toHaveTextContent('Dîner assis');
      expect(champCarte('pax', 'ag-1')).toHaveValue(40);
      expect(contactAffiche('ag-1', 'principal')).toHaveTextContent(
        'Léa Martin',
      );

      // Enregistrer : PUT …/brouillon, jamais une nouvelle création.
      fireEvent.click(
        screen.getByRole('button', { name: /Enregistrer en brouillon/ }),
      );
      await waitFor(
        () => expect(nav.push).toHaveBeenCalledWith('/brouillons'),
        ATTENTE_UI,
      );
      const URL_PUT = '/api/v1/programmation/evenements/evt-b/brouillon';
      const [corps] = envois(fetchMock, URL_PUT, 'PUT');
      expect(corps).toMatchObject({
        nom_evenement: 'Gala repris',
        nom_client_organisateur: 'Maison Dupont',
        reference_affaire: 'CMD-42',
        lieu_id: 'lieu-1',
        lieu_overrides: { adresse_acces: 'Quai 3' },
        controle_acces_requis: true,
        confirmer: false,
      });
      expect(corps!.collectes).toEqual([
        {
          type: 'zd',
          date_collecte: '2030-01-15',
          heure_collecte: '22:00',
          pax: 120,
          type_evenement_id: T_DINER,
          ...CONTACTS_PAUL_LEA,
          informations_supplementaires: 'Quai n°2',
        },
        {
          type: 'ag',
          date_collecte: '2030-01-16',
          heure_collecte: '08:00',
          pax: 40,
          type_evenement_id: T_DINER,
          contact_principal_nom: 'Léa Martin',
          contact_principal_telephone: '07 11 22 33 44',
          contact_secours_nom: null,
          contact_secours_telephone: null,
          informations_supplementaires: null,
        },
      ]);
      expect(corps).not.toHaveProperty('organisation_id');
      expect(corps).not.toHaveProperty('traiteur_operationnel_organisation_id');

      // Confirmer : même route, confirmer: true, puis l'écran de confirmation.
      fireEvent.click(
        screen.getByRole('button', { name: 'Confirmer les programmations' }),
      );
      await waitFor(
        () =>
          expect(nav.push).toHaveBeenCalledWith(
            '/programmer/confirmation?id=evt-b',
          ),
        ATTENTE_UI,
      );
      expect(envois(fetchMock, URL_PUT, 'PUT').map((c) => c.confirmer)).toEqual(
        [false, true],
      );
      expect(
        envois(fetchMock, '/api/v1/programmation/evenements', 'POST'),
      ).toEqual([]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_reprise_brouillon — brouillon déjà confirmé ou introuvable : message et lien vers les brouillons, aucun formulaire',
    async () => {
      installerFetch({
        brouillon: {
          ...BROUILLON,
          collectes: [
            { ...BROUILLON.collectes[1], statut: 'programmee' },
            BROUILLON.collectes[0],
          ],
        },
      });
      render(<RepriseBrouillonPage />);
      expect(
        await screen.findByText(
          "Cet événement n'est plus un brouillon : il a déjà été confirmé.",
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Retour aux brouillons' }),
      ).toHaveAttribute('href', '/brouillons');
      expect(screen.queryByRole('heading', { name: ECRAN_1 })).toBeNull();
      expect(screen.queryByRole('button', { name: /Continuer/ })).toBeNull();
      cleanup();
      vi.unstubAllGlobals();

      // Événement introuvable (404) : même issue.
      installerFetch({ brouillon: null });
      render(<RepriseBrouillonPage />);
      expect(
        await screen.findByText(
          'Brouillon introuvable.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Retour aux brouillons' }),
      ).toHaveAttribute('href', '/brouillons');
      expect(screen.queryByRole('button', { name: /Continuer/ })).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_reprise_brouillon — staff : le traiteur du brouillon est affiché et figé, rien n’est réattribué à l’enregistrement',
    async () => {
      session.role = 'admin_savr';
      const fetchMock = installerFetch({
        brouillon: { ...BROUILLON, organisation_id: 'org-kaspia' },
        traiteurs: [
          { id: 'org-potel', nom: 'Potel', siret: null },
          { id: 'org-kaspia', nom: 'Kaspia', siret: null },
        ],
      });
      render(<RepriseBrouillonPage />);

      const selecteur = () =>
        document.getElementById('traiteur-select') as HTMLButtonElement;
      await waitFor(
        () => expect(selecteur()).toHaveTextContent('Kaspia'),
        ATTENTE_UI,
      );
      expect(selecteur()).toBeDisabled();
      expect(
        screen.getByText(/le traiteur d’un brouillon ne change pas/),
      ).toBeInTheDocument();
      // Le pack lu est celui de l'organisation du brouillon.
      await waitFor(
        () =>
          expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain(
            '/api/v1/programmation/pack-ag?organisation_id=org-kaspia',
          ),
        ATTENTE_UI,
      );

      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      fireEvent.click(
        screen.getByRole('button', { name: /Enregistrer en brouillon/ }),
      );
      await waitFor(
        () => expect(nav.push).toHaveBeenCalledWith('/brouillons'),
        ATTENTE_UI,
      );
      const [corps] = envois(
        fetchMock,
        '/api/v1/programmation/evenements/evt-b/brouillon',
        'PUT',
      );
      expect(corps).toMatchObject({ nom_evenement: 'Gala repris' });
      expect(corps).not.toHaveProperty('organisation_id');
      expect(corps).not.toHaveProperty('traiteur_operationnel_organisation_id');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.2/formulaire_reprise_brouillon — agence : le traiteur opérant du brouillon est repris, modifiable, et renvoyé',
    async () => {
      session.role = 'agence';
      const fetchMock = installerFetch({
        brouillon: {
          ...BROUILLON,
          organisation_id: 'org-agence',
          traiteur_operationnel: { id: 't-op', nom: 'Maison Bertrand' },
        },
        // La liste plafonnée ne contient pas le traiteur du brouillon.
        traiteurs: [{ id: 'org-potel', nom: 'Potel' }],
      });
      render(<RepriseBrouillonPage />);

      const selecteur = () =>
        document.getElementById('traiteur-select') as HTMLButtonElement;
      await waitFor(
        () => expect(selecteur()).toHaveTextContent('Maison Bertrand'),
        ATTENTE_UI,
      );
      expect(selecteur()).toBeEnabled();

      fireEvent.click(continuer());
      await screen.findByRole(
        'heading',
        { level: 2, name: ECRAN_2 },
        ATTENTE_UI,
      );
      fireEvent.click(
        screen.getByRole('button', { name: /Enregistrer en brouillon/ }),
      );
      await waitFor(
        () => expect(nav.push).toHaveBeenCalledWith('/brouillons'),
        ATTENTE_UI,
      );
      const [corps] = envois(
        fetchMock,
        '/api/v1/programmation/evenements/evt-b/brouillon',
        'PUT',
      );
      expect(corps).toMatchObject({
        traiteur_operationnel_organisation_id: 't-op',
        confirmer: false,
      });
      expect(corps).not.toHaveProperty('organisation_id');
    },
    ATTENTE_CAS_MS,
  );
});
