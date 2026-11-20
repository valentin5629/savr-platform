/**
 * Photos du livreur relues chez le transporteur, A Toute! (décision Val
 * 2026-11-03) et MTS-1 (décision Val 2026-11-20) : listage pour l'Admin, aperçu
 * sans stockage, import des seules photos cochées, non visibles du client.
 * Forme des médias A Toute! = celle mesurée sur son compte le 2026-11-03.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { uploads, r2 } = vi.hoisted(() => ({
  uploads: [] as Array<{ key: string; type: string }>,
  r2: { enPanne: false },
}));
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: async (key: string, _b: Buffer, type: string) => {
    if (r2.enPanne) throw new Error('R2 indisponible');
    uploads.push({ key, type });
    return { bucket: 'savr-dev' };
  },
}));

import { _setEverestHandlers, setupEverestMock } from './everest/mock.js';
import { _setMts1Handlers, JPEG_SIMULE } from './mts1/mock.js';
import { stuffSimule, tourSimule } from './mts1/mock-tour.js';
import {
  _viderListesApercu,
  apercuPhotoTransporteur,
  importerPhotosTransporteur,
  listerPhotosTransporteur,
  PhotoTransporteurInconnueError,
} from './photos-transporteur.js';

const COLLECTE = '11111111-1111-1111-1111-111111111111';
const PRESTA_AT = 'presta-a-toutes';

interface Etat {
  typeTms: string;
  sansPrestataire?: boolean;
  fichiers: Array<{ key: string }>;
  inserts: Array<Record<string, unknown>>;
  /** L'enregistrement rend 23505 : enregistrée à l'instant par un import simultané. */
  insertDoublon?: boolean;
}

function fauxSupabase(etat: Etat): SupabaseClient {
  const table = (nom: string) => {
    const filtres: Record<string, unknown> = {};
    const resultat = () => {
      switch (nom) {
        case 'collectes':
          return {
            prestataire_logistique_id: etat.sansPrestataire ? null : PRESTA_AT,
          };
        case 'attributions_antgaspi':
          return {
            valide_at: '2026-11-03T08:00:00Z',
            transporteurs: { type_tms: etat.typeTms },
          };
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
        // Seules les lignes de photos comptent (pas les journaux d'appels).
        if (nom === 'fichiers') etat.inserts.push(ligne);
        return Promise.resolve({
          error: etat.insertDoublon
            ? { code: '23505', message: 'duplicate key value' }
            : null,
        });
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
  r2.enPanne = false;
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

  it('un transporteur sans photos lisibles (par mail) : pas pris en charge, aucun appel', async () => {
    etat.typeTms = 'par_mail';
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    expect(r).toEqual({ pris_en_charge: false });
  });

  it('sans prestataire : le transporteur de l’attribution AG validée décide, comme la fiche', async () => {
    etat.sansPrestataire = true;
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    expect(r.pris_en_charge).toBe(true);
    etat.typeTms = 'par_mail';
    expect(
      await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c'),
    ).toEqual({ pris_en_charge: false });
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

describe('course illisible', () => {
  it('une course en erreur chez le transporteur n’empêche pas de montrer les autres', async () => {
    const { _getEverestHandlers } = await import('./everest/mock.js');
    const h = _getEverestHandlers()!;
    _setEverestHandlers({
      ...h,
      getMission: async (ref) =>
        ref === 'MIS-2'
          ? { ok: false, status: 404, error: 'introuvable' }
          : h.getMission(ref),
    });
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    if (!r.pris_en_charge) throw new Error('attendu');
    expect(r.courses_illisibles).toBe(1);
    expect(r.photos.map((p) => p.course)).toEqual([1, 1]);
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
      restantes: 0,
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

  it('une photo enregistrée à l’instant par un import simultané (23505) compte comme déjà importée, pas comme un échec', async () => {
    const sb = fauxSupabase(etat);
    const liste = await listerPhotosTransporteur(sb, COLLECTE, 'c');
    if (!liste.pris_en_charge) throw new Error('attendu');
    etat.insertDoublon = true;
    const r = await importerPhotosTransporteur(sb, {
      collecteId: COLLECTE,
      ids: [liste.photos[0]!.id],
      userId: 'u-1',
      correlationId: 'c',
    });
    expect(r.importees).toBe(0);
    expect(r.deja_importees).toBe(1);
    expect(r.echecs).toBe(0);
  });

  it('au-delà du budget de temps, les photos suivantes sont rendues « restantes », pas tentées', async () => {
    const sb = fauxSupabase(etat);
    const liste = await listerPhotosTransporteur(sb, COLLECTE, 'c');
    if (!liste.pris_en_charge) throw new Error('attendu');
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now');
    // Premier appel = début de l'import ; ensuite 40 s plus tard.
    now.mockReturnValueOnce(t0).mockReturnValue(t0 + 40_000);
    const r = await importerPhotosTransporteur(sb, {
      collecteId: COLLECTE,
      ids: liste.photos.map((p) => p.id),
      userId: 'u-1',
      correlationId: 'c',
    });
    now.mockRestore();
    expect(r.importees).toBe(0);
    expect(r.restantes).toBe(3);
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

// ─── MTS-1 (décision Val 2026-11-20) ─────────────────────────────────────────
// Les commandes MIS-1 / MIS-2 sont sur les tours TOUR-MIS-1 / TOUR-MIS-2 ; le
// navigateur ne peut pas lire leurs photos (clé d'API) : l'aperçu passe par Savr.

describe('MTS-1 : photos du livreur à la demande', () => {
  // Empreinte du triplet (TOUR-MIS-1, arret-1, p1), écrite EN DUR : la même
  // formule que la relève automatique d'avant le 2026-11-20, sinon ses photos
  // déjà rangées ne seraient plus reconnues.
  const EMPREINTE_P1 =
    '46a744507f81f785c38b6d935d180f0e20306aee524fe99b93728b0319b38ad8';
  let getTour: ReturnType<typeof vi.fn>;
  let downloadPhoto: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    etat.typeTms = 'mts1';
    _viderListesApercu();
    getTour = vi.fn(async (tourId: string) => {
      const rang = tourId.endsWith('1') ? 1 : 2;
      return tourSimule({
        tourId,
        customerOrderId: `MIS-${rang}`,
        stopId: `arret-${rang}`,
        stuffs: [stuffSimule('Verre (en kg)', 3)],
        photosEnlevement: rang === 1 ? ['p1', 'p2'] : ['p3'],
      });
    });
    downloadPhoto = vi.fn(async () => JPEG_SIMULE);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      postOrder: vi.fn(),
      getTour,
      downloadPhoto,
      findOrdersByIds: vi.fn(
        async (ids: string[]) =>
          ids.map((id) => ({
            customerOrderId: id,
            orderNumber: id,
            customerOrderStatus: 'OK',
            orderDate: '2026-11-15T20:00:00.000Z',
            currentTour: {
              tourId: `TOUR-${id}`,
              stopId: 'sans-objet',
              tourDate: '2026-11-15T20:00:00.000Z',
            },
          })) as never,
      ),
    });
  });
  afterEach(() => _setMts1Handlers(null));

  it('liste les photos des courses sans rien télécharger ni stocker ; l’aperçu passe par Savr (url null)', async () => {
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    expect(r.pris_en_charge).toBe(true);
    if (!r.pris_en_charge) return;
    expect(r.photos.map((p) => [p.course, p.url])).toEqual([
      [1, null],
      [1, null],
      [2, null],
    ]);
    expect(r.photos[0]!.id).toBe(EMPREINTE_P1);
    expect(downloadPhoto).not.toHaveBeenCalled();
    expect(uploads).toEqual([]);
    expect(etat.inserts).toEqual([]);
  });

  it('une photo rangée par l’ancienne relève, recadrée ou non, est signalée déjà importée', async () => {
    etat.fichiers = [
      { key: `photos/collectes/${COLLECTE}/${EMPREINTE_P1}.jpg.recadree.jpg` },
    ];
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    if (!r.pris_en_charge) throw new Error('pris en charge attendu');
    expect(r.photos.map((p) => p.deja_importee)).toEqual([true, false, false]);
  });

  it('importe les seules photos cochées, sous la clé de toujours, non visibles du client', async () => {
    const r = await listerPhotosTransporteur(fauxSupabase(etat), COLLECTE, 'c');
    if (!r.pris_en_charge) throw new Error('pris en charge attendu');
    const res = await importerPhotosTransporteur(fauxSupabase(etat), {
      collecteId: COLLECTE,
      ids: [EMPREINTE_P1],
      userId: 'admin-1',
      correlationId: 'c',
    });
    expect(res).toEqual({
      pris_en_charge: true,
      importees: 1,
      deja_importees: 0,
      echecs: 0,
      restantes: 0,
    });
    expect(downloadPhoto).toHaveBeenCalledTimes(1);
    expect(downloadPhoto).toHaveBeenCalledWith(
      'https://mts1.test/v3/tours/photo/TOUR-MIS-1/arret-1/p1',
    );
    expect(uploads).toEqual([
      {
        key: `photos/collectes/${COLLECTE}/${EMPREINTE_P1}.jpg`,
        type: 'image/jpeg',
      },
    ]);
    expect(etat.inserts).toEqual([
      expect.objectContaining({
        bucket: 'savr-dev',
        key: `photos/collectes/${COLLECTE}/${EMPREINTE_P1}.jpg`,
        content_type: 'image/jpeg',
        entity_type: 'plateforme.collectes',
        entity_id: COLLECTE,
        created_by: 'admin-1',
        rang_client: null,
      }),
    ]);
  });

  it('une photo que MTS-1 ne rend pas (corps vide) est comptée en échec, sans rien stocker', async () => {
    downloadPhoto.mockResolvedValue(null);
    const res = await importerPhotosTransporteur(fauxSupabase(etat), {
      collecteId: COLLECTE,
      ids: [EMPREINTE_P1],
      userId: 'admin-1',
      correlationId: 'c',
    });
    expect(res.echecs).toBe(1);
    expect(res.importees).toBe(0);
    expect(uploads).toEqual([]);
    expect(etat.inserts).toEqual([]);
  });

  it("upload R2 KO → aucune ligne shared.fichiers (pas d'orpheline)", async () => {
    r2.enPanne = true;
    const res = await importerPhotosTransporteur(fauxSupabase(etat), {
      collecteId: COLLECTE,
      ids: [EMPREINTE_P1],
      userId: 'admin-1',
      correlationId: 'c',
    });
    expect(res.echecs).toBe(1);
    expect(etat.inserts).toEqual([]);
  });

  it('l’aperçu rend l’image d’une photo de la collecte sans la stocker, et relit le tour une fois pour plusieurs aperçus', async () => {
    const supabase = fauxSupabase(etat);
    const image = await apercuPhotoTransporteur(supabase, {
      collecteId: COLLECTE,
      id: EMPREINTE_P1,
      correlationId: 'c',
    });
    expect(image).toEqual({ contenu: JPEG_SIMULE, content_type: 'image/jpeg' });
    const toursLus = getTour.mock.calls.length;
    await apercuPhotoTransporteur(supabase, {
      collecteId: COLLECTE,
      id: EMPREINTE_P1,
      correlationId: 'c',
    });
    expect(getTour.mock.calls.length).toBe(toursLus);
    expect(uploads).toEqual([]);
    expect(etat.inserts).toEqual([]);
  });

  it('l’aperçu d’un id inconnu de la collecte ne télécharge rien', async () => {
    const image = await apercuPhotoTransporteur(fauxSupabase(etat), {
      collecteId: COLLECTE,
      id: 'f'.repeat(64),
      correlationId: 'c',
    });
    expect(image).toBeNull();
    expect(downloadPhoto).not.toHaveBeenCalled();
  });
});
