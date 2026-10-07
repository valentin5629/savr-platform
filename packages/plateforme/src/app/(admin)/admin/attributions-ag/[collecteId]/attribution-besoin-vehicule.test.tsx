/**
 * Écran Attribution AG dédié — besoin véhicule (nombre, type) jamais envoyé à
 * l'aveugle (revue lot 2, M2). Sur cet écran le contexte de la collecte est lu
 * après coup (GET détail). Tant qu'il n'est pas lu, ou s'il n'a pas pu l'être,
 * seul un champ que l'Admin a touché part dans le POST : sinon la valeur par
 * défaut (nb=1, type vide) écraserait un N posé par Ops. Un drapeau par champ,
 * une lecture tardive ne pose que le champ non touché.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ collecteId: 'col-1' }),
  useRouter: () => ({ push, back: vi.fn() }),
}));

import AttributionDetailPage from './page';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const ALGO = {
  associations: [
    {
      id: 'asso-top',
      nom: 'Asso Top',
      distance_km: 1.2,
      capacite_max_beneficiaires: 300,
      contact_email: 't@asso.test',
    },
  ],
  assoc_count: 1,
  transporteur: { id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x' },
  transporteurs: [{ id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x' }],
  branche: 'ag_marathon_nuit',
  is_idf: true,
  no_asso: false,
  no_prestataire: false,
  delai_minutes: 600,
  nb_pax: 150,
};
const ASSOCIATIONS = [
  {
    id: 'asso-top',
    nom: 'Asso Top',
    ville: 'Paris',
    capacite_max_beneficiaires: 300,
    habilitee_attestation_fiscale: true,
    distance_km: 1.2,
  },
];
const TRANSPORTEURS = [
  { id: 'tr-reco', nom: 'Transport Reco', type_tms: 'x', ville: 'Paris' },
];
// Collecte telle que posée par Ops : 3 véhicules, type non précisé.
const COLLECTE_OPS = {
  volume_estime_repas: 120,
  date_collecte: '2026-10-05',
  heure_collecte: '22:00:00',
  nb_camions_demande: 3,
  type_vehicule_souhaite: null,
  evenements: { pax: 150 },
};

type ReponseCollecte = { ok: boolean; body: unknown };
const lectureKo = () =>
  Promise.resolve<ReponseCollecte>({ ok: false, body: { error: 'boom' } });

function installFetch(collecteGet: () => Promise<ReponseCollecte>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (/\/api\/v1\/admin\/collectes\/col-1$/.test(url)) {
      return collecteGet().then(
        (r) => ({ ok: r.ok, json: () => Promise.resolve(r.body) }) as Response,
      );
    }
    const body = url.includes('/recommandation')
      ? { data: ALGO }
      : url.includes('/col-1/associations')
        ? { data: ASSOCIATIONS }
        : url.includes('/admin/transporteurs')
          ? { data: TRANSPORTEURS }
          : url.includes('/valider') && init?.method === 'POST'
            ? { data: { attribution_id: 'att-1' } }
            : { data: [] };
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(body),
    } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Top 1 association + transporteur recommandé pré-sélectionnés → bouton actif.
async function attendreFormulairePret() {
  const select = await screen.findByRole(
    'combobox',
    { name: 'Association' },
    ATTENTE_UI,
  );
  await waitFor(() => expect(select).toHaveTextContent('Asso Top'), ATTENTE_UI);
  return screen.getByRole('button', { name: /^Valider/ }) as HTMLButtonElement;
}

function comboboxType() {
  return screen.getByRole('combobox', { name: 'Type de véhicule souhaité' });
}

function choisirType(libelle: string) {
  fireEvent.click(comboboxType());
  fireEvent.click(screen.getByRole('option', { name: libelle }));
}

function champNombre() {
  return screen.getByLabelText('Nombre de véhicules') as HTMLInputElement;
}

function corpsValider(fetchMock: ReturnType<typeof installFetch>) {
  const post = fetchMock.mock.calls.find(([u]) =>
    String(u).includes('/valider'),
  );
  return post
    ? (JSON.parse(String(post[1]!.body)) as Record<string, unknown>)
    : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe('M2.3 / Attribution AG (écran dédié) — besoin véhicule jamais envoyé à l’aveugle', () => {
  it(
    'lecture de la collecte en échec : POST sans nombre ni type, bandeau + « Recharger la collecte »',
    async () => {
      const fetchMock = installFetch(lectureKo);
      render(<AttributionDetailPage />);
      const valider = await attendreFormulairePret();
      expect(
        await screen.findByText(
          /Impossible de lire la collecte/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Recharger la collecte' }),
      ).toBeTruthy();
      // L'attribution reste possible : elle part simplement sans ces champs.
      expect(valider.disabled).toBe(false);
      fireEvent.click(valider);

      await waitFor(() => {
        const sent = corpsValider(fetchMock);
        expect(sent).not.toBeNull();
        expect(sent).not.toHaveProperty('nb_camions_demande');
        expect(sent).not.toHaveProperty('type_vehicule_souhaite');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'lecture en échec puis type saisi seul : seul le type part, jamais nb=1 par défaut',
    async () => {
      const fetchMock = installFetch(lectureKo);
      render(<AttributionDetailPage />);
      const valider = await attendreFormulairePret();
      await screen.findByText(
        /Impossible de lire la collecte/,
        undefined,
        ATTENTE_UI,
      );
      choisirType('Camionnette');
      fireEvent.click(valider);

      await waitFor(() => {
        const sent = corpsValider(fetchMock);
        expect(sent?.type_vehicule_souhaite).toBe('camionnette');
        expect(sent).not.toHaveProperty('nb_camions_demande');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'lecture tardive (N=3 posé par Ops) pendant la saisie du type : POST avec nb=3 et le type saisi',
    async () => {
      let livrer!: (r: ReponseCollecte) => void;
      const lecture = new Promise<ReponseCollecte>((r) => {
        livrer = r;
      });
      const fetchMock = installFetch(() => lecture);
      render(<AttributionDetailPage />);
      const valider = await attendreFormulairePret();
      // L'Admin choisit le type AVANT que la collecte ne soit lue.
      choisirType('Camionnette');
      livrer({ ok: true, body: COLLECTE_OPS });

      await waitFor(() => expect(champNombre().value).toBe('3'), ATTENTE_UI);
      expect(comboboxType()).toHaveTextContent('Camionnette');
      fireEvent.click(valider);

      await waitFor(() => {
        const sent = corpsValider(fetchMock);
        expect(sent?.nb_camions_demande).toBe(3);
        expect(sent?.type_vehicule_souhaite).toBe('camionnette');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'lecture tardive (type fourgon en base) pendant la saisie du nombre : nombre saisi conservé, type lu posé',
    async () => {
      let livrer!: (r: ReponseCollecte) => void;
      const lecture = new Promise<ReponseCollecte>((r) => {
        livrer = r;
      });
      const fetchMock = installFetch(() => lecture);
      render(<AttributionDetailPage />);
      const valider = await attendreFormulairePret();
      fireEvent.click(
        screen.getByRole('button', { name: 'Ajouter un véhicule' }),
      );
      expect(champNombre().value).toBe('2');
      livrer({
        ok: true,
        body: {
          ...COLLECTE_OPS,
          nb_camions_demande: 5,
          type_vehicule_souhaite: 'fourgon',
        },
      });

      await waitFor(
        () => expect(comboboxType()).toHaveTextContent('Fourgon'),
        ATTENTE_UI,
      );
      expect(champNombre().value).toBe('2');
      fireEvent.click(valider);

      await waitFor(() => {
        const sent = corpsValider(fetchMock);
        expect(sent?.nb_camions_demande).toBe(2);
        expect(sent?.type_vehicule_souhaite).toBe('fourgon');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );
});
