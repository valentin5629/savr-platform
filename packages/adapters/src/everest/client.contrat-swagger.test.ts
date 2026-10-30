// Contrat Everest sur le chemin réseau réel (aucun handler injecté) : routes,
// corps et lecture des réponses au format du swagger Everest
// (https://a-toute.everst.io/api/swagger.json, version 1.291.1, relevé le
// 2026-10-19). La forme est celle du swagger ; les valeurs sont inventées.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiqueAmbiguousError,
  LogistiqueTransientError,
} from '../index.js';
import { EverestClient } from './client.js';
import { _setEverestHandlers } from './mock.js';

const MISSION = {
  service_id: 71,
  client_ref: 'tournee-0000-0001',
  start_date: 1784577600,
  address_start: '1 rue du Test, 75001 Paris',
  address_end: '2 rue du Test, 94200 Ivry-sur-Seine',
  comment: 'Pesée obligatoire, photo marchandise obligatoire',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('EverestClient — contrat du swagger Everest', () => {
  const fetchMock = vi.fn();
  const supabase = {
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  } as never;
  const client = () => new EverestClient(supabase);

  /** URL et corps JSON du n-ième appel. */
  function appel(n = 0): { url: string; corps: unknown; methode: string } {
    const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
    return {
      url,
      corps: JSON.parse(String(init.body)),
      methode: String(init.method),
    };
  }

  beforeEach(() => {
    _setEverestHandlers(null);
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('EVEREST_API_TOKEN', 'jeton-de-test');
    vi.stubEnv('EVEREST_BASE_URL', 'https://everest.invalid/api');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('M2.5/everest_contrat_create — POST /missions/create avec le corps tel quel ; la référence lue est mission.ref', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        mission: {
          id: 123456,
          ref: 'REF-INVENTEE-1',
          client_ref: MISSION.client_ref,
          service_id: 71,
          status: 'pending-dispatch',
        },
      }),
    );

    const creee = await client().createMission(MISSION, 'corr-1');

    expect(appel()).toEqual({
      url: 'https://everest.invalid/api/missions/create',
      methode: 'POST',
      corps: MISSION,
    });
    // `ref` (chaîne) désigne la mission pour l'annulation et la relecture ;
    // l'identifiant entier `id` n'est pas retenu.
    expect(creee).toEqual({
      mission_id: 'REF-INVENTEE-1',
      client_ref: MISSION.client_ref,
      service_id: 71,
      status: 'pending-dispatch',
    });
  });

  it.each<[string, unknown]>([
    ['sans objet mission', { id: 123456 }],
    ['mission sans ref', { mission: { id: 123456, ref: '' } }],
    ['corps illisible', 'pas du JSON'],
  ])(
    'M2.5/everest_contrat_create_sans_ref — réponse 200 %s → erreur ambiguë (une mission a pu être créée), jamais un succès',
    async (_nom, corps) => {
      fetchMock.mockResolvedValueOnce(
        typeof corps === 'string'
          ? new Response(corps, { status: 200 })
          : json(corps),
      );

      const creation = client().createMission(MISSION, 'corr-1');
      await expect(creation).rejects.toBeInstanceOf(LogistiqueAmbiguousError);
      await expect(creation).rejects.toThrow(
        'Everest createMission : réponse sans référence de mission',
      );
    },
  );

  it('M2.5/everest_contrat_cancel — POST /missions/cancel avec { ref }', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ mission: { ref: 'REF-INVENTEE-1', status: 'cancelled' } }),
    );

    const annulee = await client().cancelMission(
      { ref: 'REF-INVENTEE-1' },
      'corr-1',
    );

    expect(appel()).toEqual({
      url: 'https://everest.invalid/api/missions/cancel',
      methode: 'POST',
      corps: { ref: 'REF-INVENTEE-1' },
    });
    expect(annulee).toEqual({
      mission_id: 'REF-INVENTEE-1',
      status: 'cancelled',
    });
  });

  it('M2.5/everest_contrat_get — POST /missions/get avec { ref } ; libellé du statut, prix HT, première image, coursier et véhicule lus sur l’objet Mission', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        mission: {
          ref: 'REF-INVENTEE-1',
          status: 'pas-de-commande',
          status_text: 'Pas de commande',
          price_excl: 38,
          agent_name: 'Coursier I.',
          agent_tel: '+33100000009',
          agent_vehicle: { id: 1, name: 'Vélo cargo' },
          medias: [{ src: '' }, { src: 'https://medias.invalid/photo-1.jpg' }],
        },
      }),
    );

    const detail = await client().getMission('REF-INVENTEE-1', 'corr-1');

    expect(appel()).toEqual({
      url: 'https://everest.invalid/api/missions/get',
      methode: 'POST',
      corps: { ref: 'REF-INVENTEE-1' },
    });
    expect(detail).toEqual({
      mission_id: 'REF-INVENTEE-1',
      status: 'Pas de commande',
      cout_ht: 38,
      preuve_url: 'https://medias.invalid/photo-1.jpg',
      coursier_nom: 'Coursier I.',
      coursier_telephone: '+33100000009',
      vehicule_type: 'Vélo cargo',
    });
  });

  it('M2.5/everest_contrat_get_types_inattendus — statut, images ou véhicule d’un autre type que le swagger : lus comme absents, sans erreur', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        mission: {
          ref: 'REF-INVENTEE-1',
          status: 5,
          status_text: { libelle: 'inattendu' },
          medias: 'pas-un-tableau',
          agent_vehicle: 'velo',
          agent_name: 12,
        },
      }),
    );

    expect(await client().getMission('REF-INVENTEE-1', 'corr-1')).toEqual({
      mission_id: 'REF-INVENTEE-1',
      status: '',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });
  });

  it('M2.5/everest_contrat_get_sans_ref — relecture : réponse 200 sans mission.ref → erreur ambiguë', async () => {
    fetchMock.mockResolvedValueOnce(json({ mission: { status: 'delivered' } }));

    const lecture = client().getMission('REF-INVENTEE-1', 'corr-1');
    await expect(lecture).rejects.toBeInstanceOf(LogistiqueAmbiguousError);
    await expect(lecture).rejects.toThrow(
      'Everest getMission : réponse sans référence de mission',
    );
  });

  it('M2.5/everest_contrat_get_minimal — mission sans libellé, prix, image ni coursier : slug du statut, champs vides', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ mission: { ref: 'REF-INVENTEE-1', status: 'pending-dispatch' } }),
    );

    expect(await client().getMission('REF-INVENTEE-1', 'corr-1')).toEqual({
      mission_id: 'REF-INVENTEE-1',
      status: 'pending-dispatch',
      cout_ht: null,
      preuve_url: null,
      coursier_nom: null,
      coursier_telephone: null,
      vehicule_type: null,
    });
  });
  it('M2.5/everest_contrat_update — POST /missions/update avec { ref, champs } tel quel ; la référence lue est mission.ref', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ mission: { ref: 'REF-INVENTEE-1', status: 'assigned' } }),
    );
    const corps = {
      ref: 'REF-INVENTEE-1',
      start_date: MISSION.start_date,
      address_start: MISSION.address_start,
      address_start_name: 'Contact Inventé',
      address_start_tel: '0600000000',
      address_end: MISSION.address_end,
      address_end_name: '',
      address_end_tel: '',
      comment: MISSION.comment,
    };

    const maj = await client().updateMission(corps, 'corr-1');

    expect(appel()).toEqual({
      url: 'https://everest.invalid/api/missions/update',
      methode: 'POST',
      corps,
    });
    expect(maj).toEqual({ mission_id: 'REF-INVENTEE-1', status: 'assigned' });
  });

  it('M2.5/everest_contrat_update_sans_reponse — appel sans réponse : erreur passagère (renvoyer les mêmes valeurs ne change rien)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      client().updateMission({ ref: 'REF-INVENTEE-1' }, 'corr-1'),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
  });
});
