/**
 * M1.1b — Modale création/édition lieu (BL-P1-BOA-03).
 * Ouverte depuis la liste /admin/lieux (clic ligne, « Nouveau lieu », ?edit=).
 * Édition hydratée par GET /lieux/{id} ; POST création / PATCH édition ;
 * SIREN 9 chiffres bloquant. Remplace le cluster nouveau/[id]/modifier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { LieuModal } from '@/components/admin/lieu-modal';

const DETAIL = {
  nom: 'Château de Saint-Cloud',
  nom_alternatif: null,
  adresse_acces: '1 avenue de Paris',
  code_postal: '92210',
  ville: 'Saint-Cloud',
  acces_office: 'facile',
  stationnement: null,
  type_vehicule_max: 'fourgon',
  controle_acces_requis_default: false,
  capacite_maximum: 500,
  actif: true,
  gestionnaire_organisation_id: null,
  commentaire_lieu: null,
  siren: null,
  email_gestionnaire: null,
  reference_citeo: false,
};

type OrgOption = {
  id: string;
  raison_sociale?: string | null;
  nom?: string | null;
};

// Mock fetch routant par URL + méthode : liste gestionnaires (GET organisations),
// hydratation (GET /lieux/{id}), puis POST/PATCH d'enregistrement.
// `orgs` peuple le sélecteur « Gestionnaire de lieux » (vide par défaut).
function routeFetch(orgs: OrgOption[] = []) {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url.includes('/api/v1/admin/organisations'))
      return Promise.resolve({ ok: true, json: async () => ({ data: orgs }) });
    if (/\/api\/v1\/admin\/lieux\/[^/?]+$/.test(url) && method === 'GET')
      return Promise.resolve({ ok: true, json: async () => DETAIL });
    return Promise.resolve({ ok: true, json: async () => ({ id: 'lieu-1' }) });
  });
}

// Tous les libellés de champ attendus dans la modale (mode création) — anti-régression
// contre le retrait accidentel d'un champ (repris de l'ex lieu-form.test.tsx).
const CHAMPS: RegExp[] = [
  /Nom du lieu/,
  /Nom alternatif/,
  /Gestionnaire de lieux/,
  /Adresse accès livraison/,
  /Code postal/,
  /Ville/,
  /Accès office/,
  /Stationnement/,
  /Type de véhicule max/,
  /Capacité maximum/,
  /Contrôle d'accès requis/,
  /^Actif$/,
  /Commentaire sur le lieu/,
  /^SIREN/,
  /Mail gestionnaire du lieu/,
  /Référencé Citeo/,
];

function fillRequired() {
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
  fireEvent.change(screen.getByLabelText(/Type de véhicule max/), {
    target: { value: 'fourgon' },
  });
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

  it('création (lieuId=null) → POST /lieux + onSaved/onClose', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LieuModal open lieuId={null} onClose={onClose} onSaved={onSaved} />,
    );

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/lieux',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = postCall(fetchMock);
    const body = JSON.parse((call![1] as RequestInit).body as string) as {
      nom: string;
      type_vehicule_max: string;
    };
    expect(body.nom).toBe('Château de Saint-Cloud');
    expect(body.type_vehicule_max).toBe('fourgon');

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('édition → hydrate via GET puis PATCH /lieux/{id} avec le champ modifié', async () => {
    const onSaved = vi.fn();
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LieuModal open lieuId="lieu-42" onClose={vi.fn()} onSaved={onSaved} />,
    );

    // Le formulaire n'apparaît qu'après hydratation (GET détail), nom prérempli.
    const nom = await screen.findByLabelText(/Nom du lieu/);
    await waitFor(() =>
      expect((nom as HTMLInputElement).value).toBe('Château de Saint-Cloud'),
    );

    fireEvent.change(nom, { target: { value: 'Château rénové' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/lieux/lieu-42',
        expect.objectContaining({ method: 'PATCH' }),
      ),
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
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('SIREN invalide bloque la soumission (pas de POST /lieux)', async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    fillRequired();
    fireEvent.change(screen.getByLabelText(/^SIREN/), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

    expect(await screen.findByText(/SIREN : 9 chiffres/)).toBeInTheDocument();
    expect(postCall(fetchMock)).toBeUndefined();
  });

  it('rendu création — tous les champs de la modale sont présents', async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    for (const champ of CHAMPS) {
      expect(screen.getByLabelText(champ)).toBeInTheDocument();
    }

    // Laisse le fetch organisations se résoudre (évite un act() warning tardif).
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/organisations'),
      ),
    );
  });

  it('gestionnaire de lieux — sélecteur peuplé depuis GET /organisations', async () => {
    const fetchMock = routeFetch([
      { id: 'org-1', raison_sociale: 'Traiteur Gestionnaire SARL' },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    const option = await screen.findByRole('option', {
      name: 'Traiteur Gestionnaire SARL',
    });
    expect(option).toHaveValue('org-1');
    expect(screen.getByLabelText(/Gestionnaire de lieux/)).toBeInTheDocument();
  });

  it('champ obligatoire vide (Nom) bloque la soumission (pas de POST /lieux)', async () => {
    const fetchMock = routeFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LieuModal open lieuId={null} onClose={vi.fn()} onSaved={vi.fn()} />,
    );

    // Tout est valide sauf le Nom laissé vide.
    fillRequired();
    fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

    expect(await screen.findByText(/Nom obligatoire/)).toBeInTheDocument();
    expect(postCall(fetchMock)).toBeUndefined();
  });
});
