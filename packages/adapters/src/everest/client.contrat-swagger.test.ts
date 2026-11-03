// Contrat Everest sur le chemin réseau réel (aucun handler injecté) : routes,
// corps et lecture des réponses au format du swagger Everest
// (https://a-toute.everst.io/api/swagger.json, version 1.291.1, relevé le
// 2026-10-19). La forme est celle du swagger ; les valeurs sont inventées.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
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
          is_dispatch: false,
          is_pickup: false,
          is_success: false,
          is_fail: true,
          is_cancel: false,
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
      statut_code: 'pas-de-commande',
      etape: 'echouee',
      photos: [],
    });
  });

  it('M2.5/everest_contrat_get_etape — catégorie de l’étape lue sur les drapeaux is_* (compte A Toutes!, 2026-11-03), la fin de course prime', async () => {
    const cas: Array<[Record<string, boolean>, string | null]> = [
      [{ is_dispatch: true }, 'affectee'],
      [{ is_pickup: true }, 'enlevee'],
      [{ is_success: true }, 'reussie'],
      [{ is_fail: true }, 'echouee'],
      [{ is_cancel: true }, 'annulee'],
      [{ is_pickup: true, is_success: true }, 'reussie'],
      [{}, null],
    ];
    for (const [drapeaux, etape] of cas) {
      fetchMock.mockResolvedValueOnce(
        json({ mission: { ref: 'REF-INVENTEE-1', ...drapeaux } }),
      );
      const detail = await client().getMission('REF-INVENTEE-1', 'corr-1');
      expect(detail.etape).toBe(etape);
    }
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
      statut_code: null,
      etape: null,
      photos: [],
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
      statut_code: 'pending-dispatch',
      etape: null,
      photos: [],
    });
  });

  it('M2.5/everest_contrat_get_photos — photos du coursier : médias de type photo, en https, avec un id (forme mesurée le 2026-11-03)', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        mission: {
          ref: 'REF-INVENTEE-1',
          medias: [
            {
              src: 'https://medias.invalid/pht-1.jpg',
              type: 'photo',
              id: 101,
              date: 1793707117,
              lat: '48.9',
              lng: '2.26',
              comment: '',
            },
            {
              src: 'https://medias.invalid/sig.png',
              type: 'signature',
              id: 102,
            },
            { src: 'http://medias.invalid/pht-2.jpg', type: 'photo', id: 103 },
            { src: 'https://medias.invalid/pht-3.jpg', type: 'photo' },
            {
              src: 'https://medias.invalid/pht-4.jpg',
              type: 'photo',
              id: '104',
            },
          ],
        },
      }),
    );

    const detail = await client().getMission('REF-INVENTEE-1', 'corr-1');
    expect(detail.photos).toEqual([
      {
        id: '101',
        src: 'https://medias.invalid/pht-1.jpg',
        prise_le: new Date(1793707117 * 1000).toISOString(),
      },
      { id: '104', src: 'https://medias.invalid/pht-4.jpg', prise_le: null },
    ]);
  });

  it('M2.5/everest_contrat_photo_telechargee — GET de l’adresse publique SANS le jeton, sans redirection', async () => {
    fetchMock.mockResolvedValueOnce(
      // Type générique servi par le stockage d'A Toutes! (2026-11-03) : le
      // format se lit sur les octets.
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      }),
    );
    const photo = await client().downloadPhoto(
      'https://medias.invalid/pht-1.jpg',
    );
    expect(photo.content_type).toBe('image/jpeg');
    expect(photo.contenu.length).toBe(4);
    const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
    expect(url).toBe('https://medias.invalid/pht-1.jpg');
    expect(init.redirect).toBe('error');
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
  });

  it('M2.5/everest_contrat_photo_refusee — adresse non https ou contenu qui n’est pas une image : refusé', async () => {
    await expect(
      client().downloadPhoto('http://medias.invalid/pht-1.jpg'),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);
    fetchMock.mockResolvedValueOnce(
      new Response('<html>', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    );
    await expect(
      client().downloadPhoto('https://medias.invalid/pht-1.jpg'),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);
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
