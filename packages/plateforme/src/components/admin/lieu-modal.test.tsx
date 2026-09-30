/**
 * M1.1b — Modale création/édition lieu (BL-P1-BOA-03).
 * Ouverte depuis la liste /admin/lieux (clic ligne, « Nouveau lieu », ?edit=).
 * Édition hydratée par GET /lieux/{id} ; POST création / PATCH édition ;
 * SIREN 9 chiffres bloquant. Remplace le cluster nouveau/[id]/modifier.
 * Format fiche collecte (décisions Val 2026-09-30 C1-C4) : colonne résumé +
 * onglets Informations / Accès & logistique / Interne Savr / Activité (édition).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';

import { LieuModal } from '@/components/admin/lieu-modal';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const DETAIL = {
  nom: 'Château de Saint-Cloud',
  nom_alternatif: null,
  adresse_acces: '1 avenue de Paris',
  code_postal: '92210',
  ville: 'Saint-Cloud',
  region: 'idf',
  acces_office: 'facile',
  stationnement: null,
  type_vehicule_max: 'fourgon',
  controle_acces_requis_default: false,
  capacite_maximum: 500,
  volume_max_bacs: 12,
  contraintes_horaires: '18h-22h',
  acces_details: 'Badge accueil, interphone porte B',
  flux_autorises: ['zero_dechet', 'anti_gaspi'],
  photos_urls: ['https://r2.example/photo1.jpg'],
  actif: true,
  gestionnaire_organisation_id: null,
  commentaire_lieu: null,
  commentaires_internes: 'Migré Bubble #4210',
  siren: null,
  email_gestionnaire: null,
  reference_citeo: false,
};

const ACTIVITE = {
  traiteurs: [
    { id: 'org-k', nom: 'Kaspia', nb_collectes: 12 },
    { id: 'org-p', nom: 'Potel', nb_collectes: 1 },
  ],
  historique: [
    {
      id: 'a2',
      created_at: '2026-09-20T08:00:00Z',
      action: 'UPDATE',
      auteur: 'Val Leblan',
      champs: ['nom', 'ville'],
      impersonation: false,
    },
    {
      id: 'a1',
      created_at: '2026-09-01T08:00:00Z',
      action: 'INSERT',
      auteur: 'Val Leblan',
      champs: [],
      impersonation: false,
    },
  ],
  historique_tronque: false,
};

type OrgOption = {
  id: string;
  raison_sociale?: string | null;
  nom?: string | null;
};

// Mock fetch routant par URL + méthode : liste gestionnaires (GET organisations),
// hydratation (GET /lieux/{id}), onglet Activité (GET /lieux/{id}/activite),
// puis POST/PATCH d'enregistrement.
// `orgs` peuple le sélecteur « Gestionnaire de lieux » (vide par défaut).
function routeFetch(
  orgs: OrgOption[] = [],
  activite: { ok: boolean; body: unknown } = { ok: true, body: ACTIVITE },
) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/api/v1/admin/organisations'))
      return Promise.resolve({ ok: true, json: async () => ({ data: orgs }) });
    if (/\/api\/v1\/admin\/lieux\/[^/?]+$/.test(url) && method === 'GET')
      return Promise.resolve({ ok: true, json: async () => DETAIL });
    if (url.endsWith('/activite'))
      return Promise.resolve({
        ok: activite.ok,
        status: activite.ok ? 200 : 500,
        json: async () => activite.body,
      });
    return Promise.resolve({ ok: true, json: async () => ({ id: 'lieu-1' }) });
  });
}

// Tous les libellés de champ attendus dans la modale (mode création), rangés par
// onglet — anti-régression contre le retrait ou le déplacement d'un champ.
const CHAMPS_PAR_ONGLET: [string, RegExp[]][] = [
  [
    'Informations',
    [
      /Nom du lieu/,
      /Nom alternatif/,
      /Gestionnaire de lieux/,
      /^Actif$/,
      /Adresse accès livraison/,
      /Région/,
      /Code postal/,
      /Ville/,
    ],
  ],
  [
    'Accès & logistique',
    [
      /Type de véhicule max/,
      /Accès office/,
      /Stationnement/,
      /Contrôle d'accès requis/,
      /Carnet d'accès terrain/,
      /Capacité maximum/,
      /Volume max/,
      /Contraintes horaires/,
      /Flux autorisés/,
    ],
  ],
  [
    'Interne Savr',
    [
      /Commentaire sur le lieu/,
      /Notes internes/,
      /^SIREN/,
      /Mail gestionnaire du lieu/,
      /Référencé Citeo/,
    ],
  ],
];

// Onglets Radix : activation au mousedown (bouton gauche), pas au click.
async function ouvrirOnglet(nom: RegExp | string) {
  fireEvent.mouseDown(
    await screen.findByRole('tab', { name: nom }, ATTENTE_UI),
    { button: 0 },
  );
}

async function fillRequired() {
  fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
    target: { value: 'Château de Saint-Cloud' },
  });
  fireEvent.change(screen.getByLabelText(/Adresse accès livraison/), {
    target: { value: '1 avenue de Paris' },
  });
  fireEvent.change(screen.getByLabelText(/Code postal/), {
    target: { value: '92210' },
  });
  fireEvent.change(screen.getByLabelText(/Ville/), {
    target: { value: 'Saint-Cloud' },
  });
  await ouvrirOnglet(/Accès & logistique/);
  choisirOption(/Type de véhicule max/, 'Fourgon');
}

// Combobox (DS règle 3) : ouvrir le déclencheur puis choisir l'option (portail).
function choisirOption(libelle: RegExp, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: libelle }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

function postCall(fetchMock: ReturnType<typeof routeFetch>) {
  return fetchMock.mock.calls.find(
    ([u, o]) =>
      u === '/api/v1/admin/lieux' && (o as RequestInit)?.method === 'POST',
  );
}

describe('M1.1b — modale lieu (BL-P1-BOA-03)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it(
    'création (lieuId=null) → POST /lieux + onSaved/onClose',
    async () => {
      const onSaved = vi.fn();
      const onClose = vi.fn();
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={onClose} onSaved={onSaved} />,
      );

      await fillRequired();
      fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/admin/lieux',
            expect.objectContaining({ method: 'POST' }),
          ),
        ATTENTE_UI,
      );
      const call = postCall(fetchMock);
      const body = JSON.parse((call![1] as RequestInit).body as string) as {
        nom: string;
        type_vehicule_max: string;
      };
      expect(body.nom).toBe('Château de Saint-Cloud');
      expect(body.type_vehicule_max).toBe('fourgon');

      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(onClose).toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'édition → hydrate via GET puis PATCH /lieux/{id} avec le champ modifié',
    async () => {
      const onSaved = vi.fn();
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId="lieu-42" onClose={vi.fn()} onSaved={onSaved} />,
      );

      // Le formulaire n'apparaît qu'après hydratation (GET détail), nom prérempli.
      const nom = await screen.findByLabelText(
        /Nom du lieu/,
        undefined,
        ATTENTE_UI,
      );
      await waitFor(
        () =>
          expect((nom as HTMLInputElement).value).toBe(
            'Château de Saint-Cloud',
          ),
        ATTENTE_UI,
      );

      fireEvent.change(nom, { target: { value: 'Château rénové' } });
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/admin/lieux/lieu-42',
            expect.objectContaining({ method: 'PATCH' }),
          ),
        ATTENTE_UI,
      );
      const call = fetchMock.mock.calls.find(
        ([u, o]) =>
          u === '/api/v1/admin/lieux/lieu-42' &&
          (o as RequestInit)?.method === 'PATCH',
      );
      const body = JSON.parse((call![1] as RequestInit).body as string) as {
        nom: string;
      };
      expect(body.nom).toBe('Château rénové');
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'SIREN invalide bloque la soumission (pas de POST /lieux)',
    async () => {
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await fillRequired();
      await ouvrirOnglet(/Interne Savr/);
      fireEvent.change(screen.getByLabelText(/^SIREN/), {
        target: { value: 'abc' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

      expect(
        await screen.findByText(/SIREN : 9 chiffres/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(postCall(fetchMock)).toBeUndefined();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rendu création — tous les champs de la modale sont présents',
    async () => {
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      for (const [onglet, champs] of CHAMPS_PAR_ONGLET) {
        await ouvrirOnglet(onglet);
        for (const champ of champs) {
          expect(screen.getByLabelText(champ)).toBeInTheDocument();
        }
      }

      // Laisse le fetch organisations se résoudre (évite un act() warning tardif).
      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/admin/organisations'),
          ),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'gestionnaire de lieux — sélecteur peuplé depuis GET /organisations',
    async () => {
      const fetchMock = routeFetch([
        { id: 'org-1', raison_sociale: 'Traiteur Gestionnaire SARL' },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      // La liste est chargée de façon asynchrone : on attend le fetch, puis on
      // ouvre le Combobox pour lire l'option (portail).
      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/admin/organisations'),
          ),
        ATTENTE_UI,
      );
      fireEvent.click(
        screen.getByRole('combobox', { name: /Gestionnaire de lieux/ }),
      );
      const option = await screen.findByRole(
        'option',
        {
          name: 'Traiteur Gestionnaire SARL',
        },
        ATTENTE_UI,
      );
      expect(option).toHaveAttribute('data-value', 'org-1');
      expect(
        screen.getByLabelText(/Gestionnaire de lieux/),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'champ obligatoire vide (Nom) bloque la soumission (pas de POST /lieux)',
    async () => {
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      // Tout est valide sauf le Nom laissé vide.
      await fillRequired();
      await ouvrirOnglet(/Informations/);
      fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

      expect(
        await screen.findByText(/Nom obligatoire/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(postCall(fetchMock)).toBeUndefined();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'édition — hydrate les 7 champs réintégrés puis les renvoie au PATCH',
    async () => {
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId="lieu-77" onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      // Round-trip GET → hydratation : chaque champ réintégré prend la valeur du détail.
      const region = await screen.findByRole(
        'combobox',
        { name: /Région/ },
        ATTENTE_UI,
      );
      await waitFor(
        () => expect(region).toHaveTextContent('Île-de-France'),
        ATTENTE_UI,
      );
      await ouvrirOnglet(/Accès & logistique/);
      expect(
        (screen.getByLabelText(/Volume max/) as HTMLInputElement).value,
      ).toBe('12');
      expect(
        (screen.getByLabelText(/Contraintes horaires/) as HTMLInputElement)
          .value,
      ).toBe('18h-22h');
      expect(
        (screen.getByLabelText(/Carnet d'accès terrain/) as HTMLTextAreaElement)
          .value,
      ).toBe('Badge accueil, interphone porte B');
      // flux_autorises: string[] rendu en saisie séparée par des virgules.
      expect(
        (screen.getByLabelText(/Flux autorisés/) as HTMLInputElement).value,
      ).toBe('zero_dechet, anti_gaspi');
      // Photos en lecture seule (liste de liens R2).
      expect(screen.getByRole('link', { name: 'Photo 1' })).toBeInTheDocument();
      await ouvrirOnglet(/Interne Savr/);
      expect(
        (screen.getByLabelText(/Notes internes/) as HTMLTextAreaElement).value,
      ).toBe('Migré Bubble #4210');

      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/admin/lieux/lieu-77',
            expect.objectContaining({ method: 'PATCH' }),
          ),
        ATTENTE_UI,
      );
      const call = fetchMock.mock.calls.find(
        ([u, o]) =>
          u === '/api/v1/admin/lieux/lieu-77' &&
          (o as RequestInit)?.method === 'PATCH',
      );
      const body = JSON.parse((call![1] as RequestInit).body as string) as {
        region: string | null;
        volume_max_bacs: number | null;
        contraintes_horaires: string | null;
        acces_details: string | null;
        flux_autorises: string[] | null;
        commentaires_internes: string | null;
        photos_urls?: unknown;
      };
      expect(body.region).toBe('idf');
      expect(body.volume_max_bacs).toBe(12);
      expect(body.contraintes_horaires).toBe('18h-22h');
      expect(body.acces_details).toBe('Badge accueil, interphone porte B');
      expect(body.flux_autorises).toEqual(['zero_dechet', 'anti_gaspi']);
      expect(body.commentaires_internes).toBe('Migré Bubble #4210');
      // Les photos ne sont jamais renvoyées (jamais écrasées).
      expect(body.photos_urls).toBeUndefined();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b/lieux/fiche-onglets — édition : titre, colonne résumé et 4 onglets',
    async () => {
      vi.stubGlobal('fetch', routeFetch());
      render(
        <LieuModal open lieuId="lieu-42" onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      expect(
        await screen.findByText(
          'Lieu · Château de Saint-Cloud · Saint-Cloud',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      const onglets = screen.getAllByRole('tab').map((t) => t.textContent);
      expect(onglets).toEqual([
        'Informations',
        'Accès & logistique',
        'Interne Savr',
        'Activité',
      ]);
      // Résumé toujours visible, quel que soit l'onglet ouvert.
      await ouvrirOnglet(/Interne Savr/);
      const resume = screen.getByRole('complementary', {
        name: 'Résumé du lieu',
      });
      expect(resume).toHaveTextContent('Actif');
      expect(resume).toHaveTextContent('Saint-Cloud');
      expect(resume).toHaveTextContent('Fourgon');
      expect(resume).toHaveTextContent('Non requis');
      expect(resume).toHaveTextContent('Facile');
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M1.1b/lieux/fiche-onglets — création : 3 onglets, pas d'onglet Activité",
    async () => {
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      expect(screen.getAllByRole('tab')).toHaveLength(3);
      expect(screen.queryByRole('tab', { name: /Activité/ })).toBeNull();
      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining('/api/v1/admin/organisations'),
          ),
        ATTENTE_UI,
      );
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).endsWith('/activite')),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M1.1b/lieux/fiche-onglets — champ obligatoire d'un autre onglet : ouvre l'onglet en erreur",
    async () => {
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      // Onglet Informations complet, véhicule max (onglet Accès) laissé vide.
      fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
        target: { value: 'Château de Saint-Cloud' },
      });
      fireEvent.change(screen.getByLabelText(/Adresse accès livraison/), {
        target: { value: '1 avenue de Paris' },
      });
      fireEvent.change(screen.getByLabelText(/Code postal/), {
        target: { value: '92210' },
      });
      fireEvent.change(screen.getByLabelText(/Ville/), {
        target: { value: 'Saint-Cloud' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

      expect(
        await screen.findByText(
          /Type de véhicule max obligatoire/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      const onglet = screen.getByRole('tab', { name: /Accès & logistique/ });
      expect(onglet).toHaveAttribute('aria-selected', 'true');
      expect(onglet).toHaveAccessibleName(
        'Accès & logistique (champ à corriger)',
      );
      expect(postCall(fetchMock)).toBeUndefined();
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M1.1b/lieux/fiche-onglets — commentaire sur le lieu dans l'onglet Interne Savr (admin/ops only)",
    async () => {
      vi.stubGlobal('fetch', routeFetch());
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      expect(screen.queryByLabelText(/Commentaire sur le lieu/)).toBeNull();
      await ouvrirOnglet(/Accès & logistique/);
      expect(screen.queryByLabelText(/Commentaire sur le lieu/)).toBeNull();
      await ouvrirOnglet(/Interne Savr/);
      expect(
        screen.getByLabelText(/Commentaire sur le lieu/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/jamais montrées aux clients/),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b/lieux/fiche-onglets — onglet Activité : traiteurs opérant et historique',
    async () => {
      vi.stubGlobal('fetch', routeFetch());
      render(
        <LieuModal open lieuId="lieu-42" onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await ouvrirOnglet(/Activité/);
      expect(
        await screen.findByText('Kaspia', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/admin/lieux/lieu-42/activite',
      );
      expect(screen.getByText('12 collectes')).toBeInTheDocument();
      expect(screen.getByText('1 collecte')).toBeInTheDocument();
      expect(screen.getByText('Modification')).toBeInTheDocument();
      expect(screen.getByText('Nom du lieu, Ville')).toBeInTheDocument();
      expect(screen.getByText('Création du lieu')).toBeInTheDocument();
      expect(screen.getAllByText(/Val Leblan/)).toHaveLength(2);
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M1.1b/lieux/fiche-onglets — les saisies survivent au changement d'onglet",
    async () => {
      const fetchMock = routeFetch();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await fillRequired();
      await ouvrirOnglet(/Interne Savr/);
      fireEvent.change(screen.getByLabelText(/Commentaire sur le lieu/), {
        target: { value: 'Quai fermé le dimanche' },
      });
      await ouvrirOnglet(/Informations/);
      expect(
        (screen.getByLabelText(/Nom du lieu/) as HTMLInputElement).value,
      ).toBe('Château de Saint-Cloud');
      fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

      await waitFor(
        () => expect(postCall(fetchMock)).toBeDefined(),
        ATTENTE_UI,
      );
      const body = JSON.parse(
        (postCall(fetchMock)![1] as RequestInit).body as string,
      ) as { nom: string; type_vehicule_max: string; commentaire_lieu: string };
      expect(body.nom).toBe('Château de Saint-Cloud');
      expect(body.type_vehicule_max).toBe('fourgon');
      expect(body.commentaire_lieu).toBe('Quai fermé le dimanche');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b/lieux/fiche-onglets — la colonne résumé suit la saisie (À normaliser, Citeo)',
    async () => {
      vi.stubGlobal('fetch', routeFetch());
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      const resume = screen.getByRole('complementary', {
        name: 'Résumé du lieu',
      });
      expect(resume).toHaveTextContent('Actif');
      expect(resume).not.toHaveTextContent('Citeo');
      fireEvent.click(screen.getByRole('switch', { name: 'Actif' }));
      expect(resume).toHaveTextContent('À normaliser');
      await ouvrirOnglet(/Interne Savr/);
      fireEvent.click(screen.getByRole('switch', { name: /Référencé Citeo/ }));
      expect(resume).toHaveTextContent('Référencé');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b/lieux/fiche-onglets — onglet Activité : erreur de chargement annoncée',
    async () => {
      vi.stubGlobal(
        'fetch',
        routeFetch([], { ok: false, body: { error: 'Erreur serveur' } }),
      );
      render(
        <LieuModal open lieuId="lieu-42" onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await ouvrirOnglet(/Activité/);
      expect(
        await screen.findByText(
          /Impossible de charger l'activité du lieu/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b/lieux/fiche-onglets — historique tronqué : la limite est annoncée',
    async () => {
      vi.stubGlobal(
        'fetch',
        routeFetch([], {
          ok: true,
          body: { ...ACTIVITE, historique_tronque: true },
        }),
      );
      render(
        <LieuModal open lieuId="lieu-42" onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await ouvrirOnglet(/Activité/);
      expect(
        await screen.findByText(
          /Seules les 2 modifications les plus récentes sont affichées/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M1.1b/lieux/fiche-onglets — réponse tardive d'un lieu précédent ignorée (ni affichée ni enregistrée)",
    async () => {
      const detail = (nom: string, ville: string) => ({
        ...DETAIL,
        nom,
        ville,
        photos_urls: null,
      });
      const activite = (traiteur: string) => ({
        traiteurs: [{ id: `o-${traiteur}`, nom: traiteur, nb_collectes: 7 }],
        historique: [],
        historique_tronque: false,
      });
      const enAttente: Record<string, (v: unknown) => void> = {};
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url.includes('/organisations'))
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [] }),
          });
        if (init?.method === 'PATCH')
          return Promise.resolve({ ok: true, json: async () => ({}) });
        return new Promise((resolve) => {
          enAttente[url] = resolve;
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      const { rerender } = render(
        <LieuModal open lieuId="A" onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      // Fermer A puis ouvrir B avant que A ne réponde.
      rerender(
        <LieuModal
          open={false}
          lieuId="A"
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );
      rerender(
        <LieuModal open lieuId="B" onClose={vi.fn()} onSaved={vi.fn()} />,
      );
      // B répond d'abord, puis A (lent).
      await act(async () => {
        enAttente['/api/v1/admin/lieux/B']!({
          ok: true,
          json: async () => detail('Lieu B', 'Lyon'),
        });
        enAttente['/api/v1/admin/lieux/B/activite']!({
          ok: true,
          json: async () => activite('TraiteurDeB'),
        });
      });
      await act(async () => {
        enAttente['/api/v1/admin/lieux/A']!({
          ok: true,
          json: async () => detail('Lieu A', 'Paris'),
        });
        enAttente['/api/v1/admin/lieux/A/activite']!({
          ok: true,
          json: async () => activite('TraiteurDeA'),
        });
      });

      expect(screen.getByText('Lieu · Lieu B · Lyon')).toBeInTheDocument();
      expect(
        (screen.getByLabelText(/Nom du lieu/) as HTMLInputElement).value,
      ).toBe('Lieu B');
      await ouvrirOnglet(/Activité/);
      expect(screen.getByText('TraiteurDeB')).toBeInTheDocument();
      expect(screen.queryByText('TraiteurDeA')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          ([, o]) => (o as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(patch?.[0]).toBe('/api/v1/admin/lieux/B');
        expect(
          (
            JSON.parse((patch![1] as RequestInit).body as string) as {
              nom: string;
            }
          ).nom,
        ).toBe('Lieu B');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    "M1.1b/lieux/fiche-onglets — chargement du lieu en échec : pas de formulaire, rien d'enregistrable",
    async () => {
      const fetchMock = vi.fn((url: string) => {
        if (url.includes('/organisations'))
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [] }),
          });
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Lieu introuvable' }),
        });
      });
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId="inconnu" onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      expect(
        await screen.findByText(
          /Erreur lors du chargement du lieu/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText(/Nom du lieu/)).toBeNull();
      expect(
        screen.getByRole('button', { name: /Enregistrer/ }),
      ).toBeDisabled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M1.1b/lieux/fiche-onglets — enregistrement en échec réseau : message affiché, bouton libéré',
    async () => {
      const base = routeFetch();
      const fetchMock = vi.fn((url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? Promise.reject(new TypeError('Failed to fetch'))
          : base(url, init),
      );
      vi.stubGlobal('fetch', fetchMock);
      render(
        <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
      );

      await fillRequired();
      fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

      expect(
        await screen.findByRole('alert', undefined, ATTENTE_UI),
      ).toHaveTextContent(/Enregistrement impossible/);
      expect(
        screen.getByRole('button', { name: /Créer le lieu/ }),
      ).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Annuler' })).toBeEnabled();
    },
    ATTENTE_CAS_MS,
  );
});
