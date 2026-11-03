/**
 * Photos du livreur relues chez A Toutes! (décision Val 2026-11-03) : listage
 * pour l'Admin et import des photos cochées, non visibles du client.
 * Forme des médias = celle mesurée sur le compte A Toutes! le 2026-11-03.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { uploads } = vi.hoisted(() => ({
  uploads: [] as Array<{ key: string; type: string }>,
}));
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: async (key: string, _b: Buffer, type: string) => {
    uploads.push({ key, type });
    return { bucket: 'savr-dev' };
  },
}));

import { _setEverestHandlers, setupEverestMock } from './everest/mock.js';
import {
  importerPhotosTransporteur,
  listerPhotosTransporteur,
  PhotoTransporteurInconnueError,
} from './photos-transporteur.js';

const COLLECTE = '11111111-1111-1111-1111-111111111111';
const PRESTA_AT = 'presta-a-toutes';

interface Etat {
  typeTms: string;
  fichiers: Array<{ key: string }>;
  inserts: Array<Record<string, unknown>>;
}

function fauxSupabase(etat: Etat): SupabaseClient {
  const table = (nom: string) => {
    const filtres: Record<string, unknown> = {};
    const resultat = () => {
      switch (nom) {
        case 'collectes':
          return { prestataire_logistique_id: PRESTA_AT };
        case 'transporteurs':
          return 'type_tms' in filtres
            ? [{ prestataire_logistique_id: PRESTA_AT }]
            : { type_tms: etat.typeTms };
        case 'collecte_tournees':
          return [
            {
              rang: 2,
              tournees: {
                id: 't2',
                statut: 'terminee',
                external_ref_commande: 'MIS-2',
                prestataire_logistique_id: PRESTA_AT,
              },
            },
            {
              rang: 1,
              tournees: {
                id: 't1',
                statut: 'terminee',
                external_ref_commande: 'MIS-1',
                prestataire_logistique_id: PRESTA_AT,
              },
            },
          ];
        case 'fichiers':
          return etat.fichiers;
        default:
          return null;
      }
    };
    const c = {
      select: () => c,
      eq: (col: string, v: unknown) => {
        filtres[col] = v;
        return c;
      },
      is: () => c,
      like: () => c,
      maybeSingle: () => Promise.resolve({ data: resultat(), error: null }),
      insert: (ligne: Record<string, unknown>) => {
        etat.inserts.push(ligne);
        return Promise.resolve({ error: null });
      },
      then: (ok: (v: unknown) => void) => ok({ data: resultat(), error: null }),
    };
    return c;
  };
  return {
    from: table,
    schema: () => ({ from: table }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as SupabaseClient;
}

function poserMissions() {
  const mock = setupEverestMock();
  const base = {
    status: 'Colis remis',
    cout_ht: null,
    preuve_url: null,
    coursier_nom: null,
    coursier_telephone: null,
    vehicule_type: null,
  };
  mock.details.set('MIS-1', {
    ...base,
    mission_id: 'MIS-1',
    photos: [
      { id: '147269', src: 'https://s3.exemple.test/a.jpg', prise_le: null },
      { id: '147270', src: 'https://s3.exemple.test/b.jpg', prise_le: null },
    ],
  });
  mock.details.set('MIS-2', {
    ...base,
    mission_id: 'MIS-2',
    photos: [
      { id: '147273', src: 'https://s3.exemple.test/c.jpg', prise_le: null },
    ],
  });
  return mock;
}

let etat: Etat;
beforeEach(() => {
  uploads.length = 0;
  etat = { typeTms: 'a_toutes', fichiers: [], inserts: [] };
  poserMissions();
});
afterEach(() => _setEverestHandlers(null));

describe('listerPhotosTransporteur', () => {
  it('liste les photos de toutes les courses, dans l’ordre des courses', async () => {
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    expect(r.pris_en_charge).toBe(true);
    if (!r.pris_en_charge) return;
    expect(r.photos.map((p) => [p.course, p.url])).toEqual([
      [1, 'https://s3.exemple.test/a.jpg'],
      [1, 'https://s3.exemple.test/b.jpg'],
      [2, 'https://s3.exemple.test/c.jpg'],
    ]);
    // Identifiant opaque : aucune référence du transporteur.
    for (const p of r.photos) {
      expect(p.id).toMatch(/^[0-9a-f]{64}$/);
      expect(p.deja_importee).toBe(false);
    }
  });

  it('un transporteur autre qu’A Toutes! : pas pris en charge, aucun appel', async () => {
    etat.typeTms = 'mts1';
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    expect(r).toEqual({ pris_en_charge: false });
  });

  it('une photo déjà importée est signalée', async () => {
    const avant = await listerPhotosTransporteur(
      fauxSupabase(etat),
      COLLECTE,
      'c',
    );
    if (!avant.pris_en_charge) throw new Error('attendu');
    etat.fichiers = [
      { key: `photos/collectes/${COLLECTE}/${avant.photos[1]!.id}.jpg` },
    ];
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    if (!r.pris_en_charge) throw new Error('attendu');
    expect(r.photos.map((p) => p.deja_importee)).toEqual([false, true, false]);
  });
});

describe('importerPhotosTransporteur', () => {
  it('importe les seules photos cochées, non visibles du client', async () => {
    const sb = fauxSupabase(etat);
    const liste = await listerPhotosTransporteur(sb, COLLECTE, 'c');
    if (!liste.pris_en_charge) throw new Error('attendu');
    const choisie = liste.photos[2]!;

    const r = await importerPhotosTransporteur(sb, {
      collecteId: COLLECTE,
      ids: [choisie.id],
      userId: 'u-1',
      correlationId: 'c',
    });

    expect(r).toEqual({
      pris_en_charge: true,
      importees: 1,
      deja_importees: 0,
      echecs: 0,
    });
    expect(uploads).toEqual([
      {
        key: `photos/collectes/${COLLECTE}/${choisie.id}.jpg`,
        type: 'image/jpeg',
      },
    ]);
    expect(etat.inserts).toEqual([
      expect.objectContaining({
        key: `photos/collectes/${COLLECTE}/${choisie.id}.jpg`,
        bucket: 'savr-dev',
        entity_type: 'plateforme.collectes',
        entity_id: COLLECTE,
        created_by: 'u-1',
        rang_client: null,
      }),
    ]);
  });

  it('télécharge l’adresse relue chez le transporteur, jamais une autre', async () => {
    const vues: string[] = [];
    const mock = poserMissions();
    void mock;
    const { _getEverestHandlers } = await import('./everest/mock.js');
    const h = _getEverestHandlers()!;
    _setEverestHandlers({
      ...h,
      downloadPhoto: async (src) => {
        vues.push(src);
        return { contenu: Buffer.from([1, 2, 3]), content_type: 'image/png' };
      },
    });
    const sb = fauxSupabase(etat);
    const liste = await listerPhotosTransporteur(sb, COLLECTE, 'c');
    if (!liste.pris_en_charge) throw new Error('attendu');
    await importerPhotosTransporteur(sb, {
      collecteId: COLLECTE,
      ids: [liste.photos[0]!.id],
      userId: 'u-1',
      correlationId: 'c',
    });
    expect(vues).toEqual(['https://s3.exemple.test/a.jpg']);
    expect(uploads[0]!.key.endsWith('.png')).toBe(true);
  });

  it('un id inconnu du transporteur : rien n’est importé', async () => {
    await expect(
      importerPhotosTransporteur(fauxSupabase(etat), {
        collecteId: COLLECTE,
        ids: ['f'.repeat(64)],
        userId: 'u-1',
        correlationId: 'c',
      }),
    ).rejects.toBeInstanceOf(PhotoTransporteurInconnueError);
    expect(uploads).toEqual([]);
    expect(etat.inserts).toEqual([]);
  });

  it('une photo déjà importée n’est pas importée deux fois', async () => {
    const sb = fauxSupabase(etat);
    const liste = await listerPhotosTransporteur(sb, COLLECTE, 'c');
    if (!liste.pris_en_charge) throw new Error('attendu');
    const id = liste.photos[0]!.id;
    etat.fichiers = [{ key: `photos/collectes/${COLLECTE}/${id}.jpg` }];
    const r = await importerPhotosTransporteur(sb, {
      collecteId: COLLECTE,
      ids: [id],
      userId: 'u-1',
      correlationId: 'c',
    });
    expect(r.importees).toBe(0);
    expect(r.deja_importees).toBe(1);
    expect(uploads).toEqual([]);
  });

  it('un téléchargement en échec est compté, sans ligne en base', async () => {
    const { _getEverestHandlers } = await import('./everest/mock.js');
    const h = _getEverestHandlers()!;
    _setEverestHandlers({
      ...h,
      downloadPhoto: async () => {
        throw new Error('404');
      },
    });
    const sb = fauxSupabase(etat);
    const liste = await listerPhotosTransporteur(sb, COLLECTE, 'c');
    if (!liste.pris_en_charge) throw new Error('attendu');
    const r = await importerPhotosTransporteur(sb, {
      collecteId: COLLECTE,
      ids: [liste.photos[0]!.id],
      userId: 'u-1',
      correlationId: 'c',
    });
    expect(r.echecs).toBe(1);
    expect(etat.inserts).toEqual([]);
  });
});
