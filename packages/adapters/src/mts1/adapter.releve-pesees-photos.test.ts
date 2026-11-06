import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// L'envoi vers R2 vit dans @savr/shared : simulé, il rend l'objet écrit.
vi.mock('@savr/shared/src/r2/upload.js', () => ({
  uploadObject: vi.fn(async (key: string) => ({
    bucket: 'savr-test',
    key,
    storageKey: `savr-test/${key}`,
  })),
}));

import { uploadObject } from '@savr/shared/src/r2/upload.js';

import {
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1Tour } from './mock.js';
import { _setMts1Handlers } from './mock.js';
import {
  CONNECTEUR_SIMULE,
  JPEG_DE_TEST,
  adressePhotoSimulee,
  stuffSimule,
  tourSimule,
} from './mock-tour.js';

// ─── Relève des pesées et des photos sur la forme RÉELLE du tour ─────────────
// Tests « sur le fil » : handlers à null, `fetch` simulé, réponses dans la forme
// mesurée sur le compte de démonstration le 2026-10-13 (lecture seule). Jusqu'à
// ce lot la relève lisait `stops[].items[].weight` et `GET /v3/tours/{id}/photos`,
// qui n'existent pas : aucune pesée ni photo n'était relevée, et les tests,
// passés par des handlers à la forme supposée, restaient verts.
// La forme est celle du fil ; les valeurs sont inventées (dépôt public).

const BASE = CONNECTEUR_SIMULE;
const FENETRE = {
  depuis: new Date('2026-07-15T00:00:00Z'),
  jusqu_a: new Date('2026-07-17T00:00:00Z'),
};
const RECHERCHE = '/v3/customerOrders?minDate=2026-07-15&maxDate=2026-07-17';
const TRANSPORTEUR = {
  id: 'tr-001',
  type_tms: 'mts1' as const,
  code_transporteur_mts1: 'CA_FICTIF',
  prestataire_logistique_id: PRESTA_MTS1,
};

const FLUX = {
  biodechet: 'flux-biodechet',
  carton: 'flux-carton',
  dechet_residuel: 'flux-dechet-residuel',
  emballage: 'flux-emballage',
  verre: 'flux-verre',
};

// Les cinq flux tels que MTS-1 les rend après l'enlèvement, plus le camion.
const STUFFS_PESES = [
  stuffSimule('<volume_du_camion>', 1, 1),
  stuffSimule('Bio-déchets (en kg)', 17.5),
  stuffSimule('Carton (en kg)', 6),
  stuffSimule('D.I.B (en kg)', 35),
  stuffSimule('Film plastique (en kg)', 9.25),
  stuffSimule('Verre (en kg)', 19),
];

function commande(
  customerOrderId: string,
  statut: string,
  tourId?: string,
): Record<string, unknown> {
  return {
    customerOrderId,
    orderNumber: `numero-${customerOrderId}`,
    customerOrderStatus: statut,
    orderDate: '2026-07-15T20:00:00.000Z',
    currentTour: tourId
      ? { tourId, stopId: 'sans-objet', tourDate: '2026-07-15T20:00:00.000Z' }
      : { tourDate: '2026-07-15T20:00:00.000Z' },
  };
}

// ─── Base simulée, à ÉTAT (deux passages successifs se voient) ───────────────

type Ligne = Record<string, unknown>;
type Appel = { table: string; op: string; data?: Ligne; filtres: Ligne };

interface TourneeSimulee {
  id: string;
  /** `external_ref_commande` : l'identifiant de la commande MTS-1. */
  commande: string;
  tmsReference: string | null;
  statut: string;
}

function baseSimulee(init: {
  collecteStatut: string;
  /** Statut logistique de départ de la collecte (« acceptée » par défaut). */
  collecteStatutTms?: string;
  tournees: TourneeSimulee[];
  /** Pesées déjà en base : clé `tournée|arrêt|flux`. */
  pesees?: Record<string, number>;
  /** Ce que rend fn_agreger_terminal_collecte. */
  agregation?: string;
  /** Erreur rendue par l'écriture d'une pesée. */
  erreurPesee?: { message: string };
  /** Erreur rendue par la recherche d'un fichier (dédup des photos). */
  erreurFichiers?: { message: string };
  /** Erreur rendue par l'enregistrement d'un fichier. */
  erreurEnregistrementFichier?: { message: string };
  /** Erreur rendue par la mise à jour d'une tournée. */
  erreurTournee?: { message: string };
}) {
  const DOUBLON = { code: '23505', message: 'duplicate key value' };
  const appels: Appel[] = [];
  const etat = {
    collecte: {
      id: 'col-001',
      statut: init.collecteStatut,
      statut_tms: init.collecteStatutTms ?? 'acceptee',
    },
    tournees: init.tournees.map((t) => ({ ...t })),
    pesees: new Map(Object.entries(init.pesees ?? {})),
    inbox: new Map<string, { id: string; traite: boolean }>(),
    fichiers: new Set<string>(),
  };

  function executer(table: string, op: string, data: Ligne, filtres: Ligne) {
    appels.push({ table, op, data, filtres: { ...filtres } });

    if (table === 'flux_dechets') {
      return {
        data: Object.entries(FLUX).map(([code, id]) => ({ id, code })),
        error: null,
      };
    }
    if (table === 'parametres_algo') {
      return {
        data: [
          { cle: 'pesee_seuil_min_kg', valeur: 5 },
          { cle: 'pesee_seuil_max_kg', valeur: 5000 },
        ],
        error: null,
      };
    }
    if (table === 'integrations_inbox') {
      if (op === 'insert') {
        const cle = data['event_id_externe'] as string;
        if (etat.inbox.has(cle)) return { data: null, error: DOUBLON };
        const ligne = {
          id: `inbox-${etat.inbox.size + 1}`,
          traite: data['traite'] === true,
        };
        etat.inbox.set(cle, ligne);
        return { data: [{ id: ligne.id }], error: null };
      }
      if (op === 'select') {
        const ligne = etat.inbox.get(filtres['event_id_externe'] as string);
        return { data: ligne ? [ligne] : [], error: null };
      }
      if (op === 'update') {
        for (const ligne of etat.inbox.values()) {
          if (ligne.id === filtres['id'] && data['traite'] === true) {
            ligne.traite = true;
          }
        }
      }
      return { data: null, error: null };
    }
    if (table === 'tournees') {
      if (op === 'select' && 'external_ref_commande' in filtres) {
        const t = etat.tournees.find(
          (x) => x.commande === filtres['external_ref_commande'],
        );
        return {
          data: t
            ? [
                {
                  id: t.id,
                  statut: t.statut,
                  tms_reference: t.tmsReference,
                  collecte_tournees: [
                    {
                      collecte_id: etat.collecte.id,
                      collectes: { ...etat.collecte },
                    },
                  ],
                },
              ]
            : [],
          error: null,
        };
      }
      if (op === 'update') {
        if (init.erreurTournee)
          return { data: null, error: init.erreurTournee };
        const t = etat.tournees.find((x) => x.id === filtres['id']);
        if (t && typeof data['statut'] === 'string') t.statut = data['statut'];
      }
      return { data: [], error: null };
    }
    if (table === 'collectes' && op === 'update') {
      const admis = filtres['statut'] as string[] | undefined;
      const admisTms = filtres['statut_tms'] as string[] | undefined;
      const sauf = filtres['neq:statut_tms'];
      if (
        (!admis || admis.includes(etat.collecte.statut)) &&
        (!admisTms || admisTms.includes(etat.collecte.statut_tms)) &&
        (sauf === undefined || sauf !== etat.collecte.statut_tms)
      ) {
        if (typeof data['statut'] === 'string') {
          etat.collecte.statut = data['statut'];
        }
        if (typeof data['statut_tms'] === 'string') {
          etat.collecte.statut_tms = data['statut_tms'];
        }
      }
      return { data: null, error: null };
    }
    if (table === 'pesees_tournees') {
      if (op === 'select') {
        const prefixe = `${String(filtres['tournee_id'])}|${String(filtres['stop_id'])}|`;
        return {
          data: [...etat.pesees.entries()]
            .filter(([cle]) => cle.startsWith(prefixe))
            .map(([cle, poids_kg]) => ({
              flux_id: cle.slice(prefixe.length),
              poids_kg,
            })),
          error: null,
        };
      }
      if (op === 'upsert') {
        if (init.erreurPesee) return { data: null, error: init.erreurPesee };
        etat.pesees.set(
          `${String(data['tournee_id'])}|${String(data['stop_id'])}|${String(data['flux_id'])}`,
          data['poids_kg'] as number,
        );
      }
      return { data: null, error: null };
    }
    if (table === 'fichiers') {
      if (op === 'select' && init.erreurFichiers) {
        return { data: null, error: init.erreurFichiers };
      }
      if (op === 'select') {
        return {
          data: etat.fichiers.has(filtres['key'] as string)
            ? [{ id: 'fichier' }]
            : [],
          error: null,
        };
      }
      if (op === 'insert') {
        if (init.erreurEnregistrementFichier) {
          return { data: null, error: init.erreurEnregistrementFichier };
        }
        etat.fichiers.add(data['key'] as string);
      }
    }
    return { data: null, error: null };
  }

  function requete(table: string) {
    let op = 'select';
    let data: Ligne = {};
    const filtres: Ligne = {};
    const resoudre = () => Promise.resolve(executer(table, op, data, filtres));
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (d: Ligne) => ((op = 'insert'), (data = d), b),
      upsert: (d: Ligne) => ((op = 'upsert'), (data = d), b),
      update: (d: Ligne) => ((op = 'update'), (data = d), b),
      eq: (c: string, v: unknown) => ((filtres[c] = v), b),
      in: (c: string, v: unknown) => ((filtres[c] = v), b),
      neq: (c: string, v: unknown) => ((filtres[`neq:${c}`] = v), b),
      limit: () => resoudre(),
      maybeSingle: () =>
        resoudre().then((r) => ({
          ...r,
          data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        })),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        resoudre().then(ok, ko),
    };
    return b;
  }

  const from = (table: string) =>
    table === 'transporteurs' ? builderTransporteurs() : requete(table);
  const supabase = {
    from,
    schema: () => ({ from }),
    rpc: (nom: string, args: Ligne) => {
      appels.push({ table: nom, op: 'rpc', data: args, filtres: {} });
      const resultat = {
        data:
          nom === 'fn_agreger_terminal_collecte'
            ? (init.agregation ?? 'pending')
            : null,
        error: null,
      };
      return {
        single: () => Promise.resolve(resultat),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(resultat).then(ok, ko),
      };
    },
  };

  return {
    supabase: supabase as never,
    etat,
    appels,
    /** Appels d'une table et d'une opération, dans l'ordre. */
    de: (table: string, op: string) =>
      appels.filter((a) => a.table === table && a.op === op),
    /** Lignes de journal d'erreur de la relève, par code. */
    journal: (code: string) =>
      appels.filter(
        (a) =>
          a.table === 'integrations_logs' &&
          String(a.data?.['erreur']).startsWith(`${code}:`),
      ),
    alertes: (code: string) =>
      appels.filter(
        (a) =>
          a.table === 'f_upsert_alerte_admin' && a.data?.['p_code'] === code,
      ),
  };
}

// ─── Prestataire simulé sur le fil ───────────────────────────────────────────

type Reponse = { status?: number; json?: unknown; corps?: Buffer | string };

function filSimule(reponses: Record<string, Reponse>) {
  const vus: Array<{ chemin: string; cle: string | undefined }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      const chemin = url.replace(BASE, '');
      vus.push({ chemin, cle: init?.headers?.['Authorization'] });
      const r = reponses[chemin];
      if (!r) throw new Error(`adresse inattendue : ${url}`);
      // Une vraie réponse HTTP : son corps se lit en flux, comme sur le fil.
      const corps = r.corps ?? JSON.stringify(r.json ?? null);
      return new Response(
        typeof corps === 'string' ? corps : new Uint8Array(corps),
        { status: r.status ?? 200 },
      );
    }) as never,
  );
  return {
    vus,
    chemins: () => vus.map((v) => v.chemin),
    /** Remplace ou ajoute une réponse entre deux passages. */
    poser: (chemin: string, r: Reponse) => {
      reponses[chemin] = r;
    },
  };
}

const TOURNEE_1: TourneeSimulee = {
  id: 'tournee-1',
  commande: 'CMD-A',
  tmsReference: 'TOUR-1',
  statut: 'planifiee',
};

function tourA(opts: Partial<Parameters<typeof tourSimule>[0]> = {}): Mts1Tour {
  return tourSimule({
    tourId: 'TOUR-1',
    customerOrderId: 'CMD-A',
    stopId: 'arret-a',
    stuffs: STUFFS_PESES,
    ...opts,
  });
}

function releve(base: ReturnType<typeof baseSimulee>): Promise<void> {
  return new AdapterMts1(TRANSPORTEUR, base.supabase).sync(FENETRE);
}

describe('M1.5b / relève MTS-1 — pesées et photos sur la forme réelle du tour', () => {
  beforeEach(() => {
    _setMts1Handlers(null); // force le chemin réel (fetch)
    vi.stubEnv('MTS1_BASE_URL', BASE);
    vi.stubEnv('MTS1_API_KEY', 'cle-de-test');
    vi.mocked(uploadObject).mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    _setMts1Handlers(null);
  });

  // ── Pesées ────────────────────────────────────────────────────────────────

  it('M1.5b/releve_fil_pesees_enlevement_seul — les kilos sont lus dans quantityAfterPickup, sur l’arrêt d’enlèvement seul', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      // Les mêmes stuffs sont répétés sur l'arrêt de dépôt : les lire aux deux
      // endroits doublerait chaque poids.
      '/v3/tours/TOUR-1': { json: tourA() },
    });

    await releve(base);

    expect(
      base.de('pesees_tournees', 'upsert').map((a) => ({
        tournee: a.data!['tournee_id'],
        arret: a.data!['stop_id'],
        flux: a.data!['flux_id'],
        kg: a.data!['poids_kg'],
      })),
    ).toEqual([
      {
        tournee: 'tournee-1',
        arret: 'arret-a',
        flux: FLUX.biodechet,
        kg: 17.5,
      },
      { tournee: 'tournee-1', arret: 'arret-a', flux: FLUX.carton, kg: 6 },
      {
        tournee: 'tournee-1',
        arret: 'arret-a',
        flux: FLUX.dechet_residuel,
        kg: 35,
      },
      {
        tournee: 'tournee-1',
        arret: 'arret-a',
        flux: FLUX.emballage,
        kg: 9.25,
      },
      { tournee: 'tournee-1', arret: 'arret-a', flux: FLUX.verre, kg: 19 },
    ]);
    // Le stuff « camion » n'est pas un flux, et aucune commande n'est en échec.
    expect(base.journal('STUFF_INCONNU')).toEqual([]);
    expect(base.journal('SYNC_ORDER_FAILED')).toEqual([]);
    // Deux lectures et rien d'autre : la recherche, puis le tour de la commande.
    expect(fil.chemins()).toEqual([RECHERCHE, '/v3/tours/TOUR-1']);
  });

  it('M1.5b/releve_fil_flux_repete — un même flux répété sur l’arrêt garde sa dernière valeur, stable d’un passage à l’autre', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({
          stuffs: [
            stuffSimule('Verre (en kg)', 12),
            stuffSimule('Verre (en kg)', 14),
          ],
        }),
      },
    });

    await releve(base);
    await releve(base);

    expect(base.etat.pesees.get(`tournee-1|arret-a|${FLUX.verre}`)).toBe(14);
    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(1);
  });

  it('M1.5b/releve_fil_poids_absent_ou_nul — un flux sans saisie (null) ou à 0 n’écrit aucune pesée', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({
          stuffs: [
            stuffSimule('<volume_du_camion>', 1, 1),
            stuffSimule('Bio-déchets (en kg)', null), // rien saisi
            stuffSimule('Carton (en kg)', 0), // flux non pesé (Val 2026-10-13)
            // `quantity` et `measurement.weight` ne sont pas des poids.
            {
              ...stuffSimule('Verre (en kg)', null, 40),
              measurement: { weight: 40 },
            },
            stuffSimule('D.I.B (en kg)', 12),
          ],
        }),
      },
    });

    await releve(base);

    expect(
      base
        .de('pesees_tournees', 'upsert')
        .map((a) => [a.data!['flux_id'], a.data!['poids_kg']]),
    ).toEqual([[FLUX.dechet_residuel, 12]]);
  });

  it('M1.5b/releve_fil_deux_commandes_meme_tour — chaque commande n’est lue que sur SON arrêt, dans le tour qu’elle désigne', async () => {
    // Collecte à deux camions dont la commande du rang 2 a été déplacée sur le
    // tour du rang 1 (cas mesuré sur le compte de démonstration) : deux arrêts
    // d'enlèvement, UN dépôt partagé qui liste les deux commandes et leurs douze
    // stuffs, et le tour du rang 2 resté vide.
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [
        TOURNEE_1,
        {
          id: 'tournee-2',
          commande: 'CMD-B',
          tmsReference: 'TOUR-2',
          statut: 'planifiee',
        },
      ],
    });
    const stuffsB = [
      stuffSimule('<volume_du_camion>', 1, 1),
      stuffSimule('Bio-déchets (en kg)', 40),
      stuffSimule('Verre (en kg)', 8),
    ];
    const nomme = (id: string) => [
      { customerOrderId: id, customerOrderProgressionStatus: 'NOT_STARTED' },
    ];
    const fil = filSimule({
      [RECHERCHE]: {
        json: [
          commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1'),
          // Le rang 2 désigne le tour du rang 1, pas celui que l'envoi a créé.
          commande('CMD-B', 'IN_PROGRESSION', 'TOUR-1'),
        ],
      },
      '/v3/tours/TOUR-1': {
        json: {
          tourId: 'TOUR-1',
          status: { dispatch: 'PROPOSED', progression: 'NOT_STARTED' },
          stops: [
            {
              stopId: 'arret-a',
              stopType: 'CUSTOMER_ORDER',
              customerOrders: nomme('CMD-A'),
              stuffs: STUFFS_PESES,
            },
            {
              stopId: 'arret-b',
              stopType: 'CUSTOMER_ORDER',
              customerOrders: nomme('CMD-B'),
              stuffs: stuffsB,
            },
            {
              stopId: 'depot',
              stopType: 'DEPOT',
              customerOrders: [...nomme('CMD-A'), ...nomme('CMD-B')],
              stuffs: [...STUFFS_PESES, ...stuffsB],
            },
          ],
        } satisfies Mts1Tour,
      },
    });

    await releve(base);

    expect(Object.fromEntries(base.etat.pesees)).toEqual({
      [`tournee-1|arret-a|${FLUX.biodechet}`]: 17.5,
      [`tournee-1|arret-a|${FLUX.carton}`]: 6,
      [`tournee-1|arret-a|${FLUX.dechet_residuel}`]: 35,
      [`tournee-1|arret-a|${FLUX.emballage}`]: 9.25,
      [`tournee-1|arret-a|${FLUX.verre}`]: 19,
      [`tournee-2|arret-b|${FLUX.biodechet}`]: 40,
      [`tournee-2|arret-b|${FLUX.verre}`]: 8,
    });
    // Le tour vide du rang 2 n'est pas lu : la commande dit où elle est.
    expect(fil.chemins()).not.toContain('/v3/tours/TOUR-2');
  });

  it('M1.5b/releve_tour_enregistre_a_defaut — sans tour désigné par la commande, le tour enregistré à l’envoi est lu', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION')] },
      '/v3/tours/TOUR-1': { json: tourA() },
    });

    await releve(base);

    expect(fil.chemins()).toContain('/v3/tours/TOUR-1');
    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(5);
  });

  it('M1.5b/releve_fil_depot_avant_enlevement — un dépôt listé avant l’enlèvement, qui nomme la même commande, n’est jamais lu', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const nomme = [
      {
        customerOrderId: 'CMD-A',
        customerOrderProgressionStatus: 'NOT_STARTED',
      },
    ];
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: {
          tourId: 'TOUR-1',
          status: { dispatch: 'ACCEPTED', progression: 'NOT_STARTED' },
          stops: [
            // Le dépôt d'abord, avec d'autres poids : seul l'enlèvement compte.
            {
              stopId: 'depot',
              stopType: 'DEPOT',
              customerOrders: nomme,
              stuffs: [
                stuffSimule('Bio-déchets (en kg)', 99),
                stuffSimule('Verre (en kg)', 88),
              ],
            },
            {
              stopId: 'arret-a',
              stopType: 'CUSTOMER_ORDER',
              customerOrders: nomme,
              stuffs: [stuffSimule('Bio-déchets (en kg)', 17.5)],
            },
          ],
        } satisfies Mts1Tour,
      },
    });

    await releve(base);

    expect(Object.fromEntries(base.etat.pesees)).toEqual({
      [`tournee-1|arret-a|${FLUX.biodechet}`]: 17.5,
    });
  });

  it('M1.5b/releve_fil_don_alimentaire_ignore — le don d’une collecte AG n’est ni une pesée ni un stuff inconnu', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({
          stuffs: [
            // Libellé que l'adapter envoie lui-même pour une collecte AG : son
            // poids est saisi par l'équipe Savr (§06.09).
            stuffSimule('Don alimentaire', 40),
            // Témoin : un libellé vraiment inconnu reste tracé.
            stuffSimule('Gravats (en kg)', 320),
          ],
        }),
      },
    });

    await releve(base);

    expect(base.de('pesees_tournees', 'upsert')).toEqual([]);
    expect(base.journal('STUFF_INCONNU').map((a) => a.data!['erreur'])).toEqual(
      ['STUFF_INCONNU: tournee=tournee-1 stop=arret-a stuff="Gravats (en kg)"'],
    );
    expect(base.journal('SYNC_ORDER_FAILED')).toEqual([]);
  });

  it('M1.5b/releve_pesee_non_ecrite — une pesée que la base refuse fait échouer la commande, dont le statut sera rejoué', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      erreurPesee: { message: 'connexion perdue' },
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tourA({ terminee: true }) },
    });

    await releve(base);

    expect(base.journal('SYNC_ORDER_FAILED')).toHaveLength(1);
    // Ni tournée terminée, ni agrégation : la collecte ne passe pas « réalisée »
    // sur des pesées manquantes, et la clé du statut reste à rejouer.
    expect(base.etat.tournees[0]!.statut).toBe('planifiee');
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toEqual([]);
    expect(base.etat.inbox.get('mts1:CMD-A:OK')).toMatchObject({
      traite: false,
    });
  });

  // ── Relecture à chaque passage ────────────────────────────────────────────

  it('M1.5b/releve_tour_relu_a_chaque_passage — statut inchangé : le tour est relu, seule la pesée corrigée est réécrite', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tourA() },
    });

    await releve(base);
    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(5);
    const statutsApresUn = base.de('collectes', 'update').length;

    // Deuxième passage : même statut de commande, le chauffeur a corrigé le verre.
    fil.poser('/v3/tours/TOUR-1', {
      json: tourA({
        stuffs: STUFFS_PESES.map((s) =>
          s.name === 'Verre (en kg)' ? stuffSimule(s.name, 21) : s,
        ),
      }),
    });
    await releve(base);

    // Le statut n'est pas rejoué…
    expect(base.de('collectes', 'update')).toHaveLength(statutsApresUn);
    // … mais le tour est relu, et seule la pesée modifiée est réécrite.
    expect(fil.chemins().filter((c) => c === '/v3/tours/TOUR-1')).toHaveLength(
      2,
    );
    const ecritures = base.de('pesees_tournees', 'upsert');
    expect(ecritures).toHaveLength(6);
    expect(ecritures[5]!.data).toMatchObject({
      flux_id: FLUX.verre,
      poids_kg: 21,
    });
    expect(base.etat.pesees.get(`tournee-1|arret-a|${FLUX.verre}`)).toBe(21);
  });

  it('M1.5b/releve_pesee_hors_seuil_une_fois — l’alerte « hors seuil » est levée à l’écriture de la pesée, pas à chaque relecture', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        // 2 kg : sous le seuil bas de 5 kg.
        json: tourA({ stuffs: [stuffSimule('Carton (en kg)', 2)] }),
      },
    });

    await releve(base);
    await releve(base);
    await releve(base);

    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(1);
    expect(base.alertes('pesee_hors_seuil')).toHaveLength(1);
  });

  it('M1.5b/releve_pesee_corrigee_avant_cloture — collecte réalisée : la pesée corrigée est écrite et les poids de la collecte recalculés', async () => {
    const base = baseSimulee({
      collecteStatut: 'realisee',
      tournees: [{ ...TOURNEE_1, statut: 'terminee' }],
      pesees: { [`tournee-1|arret-a|${FLUX.verre}`]: 19 },
      agregation: 'realisee',
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({
          terminee: true,
          stuffs: [stuffSimule('Verre (en kg)', 23)],
        }),
      },
    });

    // Premier passage : le statut OK est nouveau, la pesée corrigée est écrite et
    // la collecte agrégée.
    await releve(base);
    expect(base.etat.pesees.get(`tournee-1|arret-a|${FLUX.verre}`)).toBe(23);
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toHaveLength(1);

    // Passages suivants, rien n'a changé : ni écriture, ni agrégation.
    await releve(base);
    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(1);
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toHaveLength(1);

    // Nouvelle correction, statut toujours OK : `collecte_flux` est un dérivé,
    // seule l'agrégation le recalcule.
    vi.unstubAllGlobals();
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({
          terminee: true,
          stuffs: [stuffSimule('Verre (en kg)', 25)],
        }),
      },
    });
    await releve(base);
    expect(base.etat.pesees.get(`tournee-1|arret-a|${FLUX.verre}`)).toBe(25);
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toHaveLength(2);
    // La tournée, déjà terminée, n'est pas réécrite.
    expect(base.de('tournees', 'update')).toEqual([]);
  });

  it('M1.5b/releve_divergence_post_cloture_une_fois — collecte clôturée : rien n’est écrit, la divergence est signalée une fois par valeur', async () => {
    const base = baseSimulee({
      collecteStatut: 'cloturee',
      tournees: [{ ...TOURNEE_1, statut: 'terminee' }],
      pesees: { [`tournee-1|arret-a|${FLUX.verre}`]: 19 },
    });
    // Le statut OK a été traité avant la clôture, à la fin du tour.
    base.etat.inbox.set('mts1:CMD-A:OK', { id: 'inbox-ok', traite: true });
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({
          terminee: true,
          stuffs: [
            stuffSimule('Verre (en kg)', 23), // ≠ 19 en base
            stuffSimule('Carton (en kg)', 6), // aucun poids en base
          ],
        }),
      },
    });

    await releve(base);
    await releve(base);
    await releve(base);

    // Jamais d'écriture de pesée ni d'agrégation sur une collecte clôturée.
    expect(base.de('pesees_tournees', 'upsert')).toEqual([]);
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toEqual([]);
    expect(base.etat.pesees.get(`tournee-1|arret-a|${FLUX.verre}`)).toBe(19);
    // Trois passages, deux divergences : deux traces, deux alertes posées.
    expect(
      base
        .journal('PESEE_DIVERGENCE_POST_CLOTURE')
        .map((a) => a.data!['erreur']),
    ).toEqual([
      'PESEE_DIVERGENCE_POST_CLOTURE: tournee=tournee-1 stop=arret-a flux=verre local=19 kg distant=23',
      'PESEE_DIVERGENCE_POST_CLOTURE: tournee=tournee-1 stop=arret-a flux=carton local=aucun distant=6',
    ]);
    expect(base.alertes('pesee_divergence_post_cloture')).toHaveLength(2);

    // Le poids distant change encore : nouvelle valeur, nouveau signal.
    fil.poser('/v3/tours/TOUR-1', {
      json: tourA({
        terminee: true,
        stuffs: [stuffSimule('Verre (en kg)', 24)],
      }),
    });
    await releve(base);
    expect(base.journal('PESEE_DIVERGENCE_POST_CLOTURE')).toHaveLength(3);
    expect(base.de('pesees_tournees', 'upsert')).toEqual([]);
  });

  // ── Fin de mission ────────────────────────────────────────────────────────

  it('M1.5b/releve_fin_de_mission_sur_arret — FINISHED sur l’arrêt d’enlèvement termine la tournée, que la commande soit VALIDATED ou ARCHIVED', async () => {
    for (const statut of ['VALIDATED', 'ARCHIVED']) {
      vi.unstubAllGlobals();
      const base = baseSimulee({
        collecteStatut: 'en_cours',
        tournees: [TOURNEE_1],
        agregation: 'realisee',
      });
      const fil = filSimule({
        [RECHERCHE]: { json: [commande('CMD-A', statut, 'TOUR-1')] },
        '/v3/tours/TOUR-1': { json: tourA() }, // mission pas commencée
      });

      await releve(base);
      expect(base.etat.tournees[0]!.statut, statut).toBe('planifiee');
      expect(base.de('fn_agreger_terminal_collecte', 'rpc'), statut).toEqual(
        [],
      );

      // Passage suivant : même statut de commande, mais l'arrêt est terminé.
      fil.poser('/v3/tours/TOUR-1', { json: tourA({ terminee: true }) });
      await releve(base);

      expect(base.etat.tournees[0]!.statut, statut).toBe('terminee');
      // Les pesées sont écrites AVANT l'agrégation, qui en dérive les poids.
      const ordre = base.appels
        .filter(
          (a) =>
            (a.table === 'pesees_tournees' && a.op === 'upsert') ||
            a.table === 'fn_agreger_terminal_collecte',
        )
        .map((a) => a.table);
      expect(ordre.at(-1), statut).toBe('fn_agreger_terminal_collecte');
      expect(
        ordre.filter((t) => t === 'fn_agreger_terminal_collecte'),
        statut,
      ).toHaveLength(1);
    }
  });

  it('M1.5b/releve_fin_sur_arret_bornee — FINISHED ne requalifie ni une collecte sortie d’exécution ni un refus', async () => {
    // Collecte annulée chez Savr : la tournée reste telle quelle.
    const annulee = baseSimulee({
      collecteStatut: 'annulee',
      tournees: [{ ...TOURNEE_1, statut: 'annulee' }],
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'VALIDATED', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tourA({ terminee: true }) },
    });
    await releve(annulee);
    expect(annulee.etat.tournees[0]!.statut).toBe('annulee');
    expect(annulee.de('fn_agreger_terminal_collecte', 'rpc')).toEqual([]);

    // Commande refusée (CANCELED) : c'est le refus qui s'écrit, pas la fin.
    vi.unstubAllGlobals();
    const refusee = baseSimulee({
      collecteStatut: 'validee',
      tournees: [TOURNEE_1],
      agregation: 'rejetee_par_prestataire',
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'CANCELED', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tourA({ terminee: true }) },
    });
    await releve(refusee);
    expect(refusee.etat.tournees[0]!.statut).toBe('annulee');
  });

  it('M1.5b/releve_fin_par_statut_inchangee — OK termine la tournée une fois, à l’arrivée du statut', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      agregation: 'realisee',
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      // L'arrêt ne dit rien de la fin : seul le statut la porte.
      '/v3/tours/TOUR-1': { json: tourA() },
    });

    await releve(base);
    expect(base.etat.tournees[0]!.statut).toBe('terminee');
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toHaveLength(1);
    expect(base.etat.inbox.get('mts1:CMD-A:OK')).toMatchObject({
      traite: true,
    });

    await releve(base);
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toHaveLength(1);
  });

  it('M1.5b/releve_refus_deja_traite — un refus déjà traité n’est ni rejoué ni recouvert par FINISHED', async () => {
    // Collecte à deux camions encore en cours : ce camion a été refusé (statut
    // déjà traité), l'autre roule. Son arrêt finit par porter FINISHED.
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [{ ...TOURNEE_1, statut: 'annulee' }],
      agregation: 'realisee',
    });
    base.etat.inbox.set('mts1:CMD-A:CANCELED', {
      id: 'inbox-refus',
      traite: true,
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'CANCELED', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tourA({ terminee: true }) },
    });

    await releve(base);
    await releve(base);

    expect(base.etat.tournees[0]!.statut).toBe('annulee');
    expect(base.de('tournees', 'update')).toEqual([]);
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toEqual([]);
    expect(base.alertes('collecte_partiellement_servie')).toEqual([]);
  });

  it('M1.5b/releve_tournee_non_ecrite — une tournée que la base refuse de terminer fait échouer la commande, sans agrégation', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      agregation: 'realisee',
      erreurTournee: { message: 'connexion perdue' },
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tourA({ terminee: true }) },
    });

    await releve(base);

    expect(base.journal('SYNC_ORDER_FAILED')).toHaveLength(1);
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toEqual([]);
    expect(base.etat.inbox.get('mts1:CMD-A:OK')).toMatchObject({
      traite: false,
    });
  });

  it('M1.5b/releve_fin_par_statut_partial — PARTIAL termine la tournée, comme OK', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      agregation: 'realisee',
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'PARTIAL', 'TOUR-1')] },
      // L'arrêt ne dit rien de la fin : seul le statut la porte.
      '/v3/tours/TOUR-1': { json: tourA() },
    });

    await releve(base);

    expect(base.etat.tournees[0]!.statut).toBe('terminee');
    expect(base.de('fn_agreger_terminal_collecte', 'rpc')).toHaveLength(1);
  });

  // ── Photos ────────────────────────────────────────────────────────────────

  it('M1.5b/releve_fil_photos_detail_du_tour — les photos se lisent dans le détail du tour, se téléchargent avec la clé et arrivent décodées', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const photo = (nom: string) =>
      Buffer.concat([JPEG_DE_TEST, Buffer.from(nom)]);
    const chemin = (arret: string, id: string) =>
      adressePhotoSimulee('TOUR-1', arret, id).replace(BASE, '');
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({
          photosEnlevement: ['photo-enlevement'],
          photosDepot: ['photo-depot'],
          typeDepot: 'CUSTOMER_ORDER_LINKED',
        }),
      },
      // Le corps n'est pas le fichier : c'est le JPEG écrit en base64.
      [chemin('arret-a', 'photo-enlevement')]: {
        corps: photo('enlevement').toString('base64'),
      },
      [chemin('arret-a-depot', 'photo-depot')]: {
        corps: photo('depot').toString('base64'),
      },
    });

    await releve(base);

    // Enlèvement ET dépôt, chacune demandée avec la clé d'API.
    const telechargements = fil.vus.filter((v) =>
      v.chemin.startsWith('/v3/tours/photo/'),
    );
    expect(telechargements.map((v) => v.chemin)).toEqual([
      chemin('arret-a', 'photo-enlevement'),
      chemin('arret-a-depot', 'photo-depot'),
    ]);
    expect(telechargements.map((v) => v.cle)).toEqual([
      'Bearer cle-de-test',
      'Bearer cle-de-test',
    ]);
    // La route qu'appelait l'ancien code (404 BAD_ROUTE) n'est plus demandée.
    expect(fil.chemins()).not.toContain('/v3/tours/TOUR-1/photos');

    // Les octets envoyés au stockage sont ceux du JPEG, pas son base64.
    const envois = vi.mocked(uploadObject).mock.calls;
    expect(
      envois.map((e) => (e[1] as Buffer).equals(photo('enlevement'))),
    ).toEqual([true, false]);
    expect((envois[1]![1] as Buffer).equals(photo('depot'))).toBe(true);
    expect(envois.map((e) => e[2])).toEqual(['image/jpeg', 'image/jpeg']);
    // Clés distinctes, opaques, rangées sous la collecte.
    const cles = envois.map((e) => e[0]);
    expect(new Set(cles).size).toBe(2);
    for (const cle of cles) {
      expect(cle).toMatch(/^photos\/collectes\/col-001\/[0-9a-f]{64}\.jpg$/);
    }
    expect(
      base.de('fichiers', 'insert').map((a) => a.data!['entity_type']),
    ).toEqual(['plateforme.collectes', 'plateforme.collectes']);

    // Passage suivant : les deux photos sont connues, aucun téléchargement.
    await releve(base);
    expect(
      fil.vus.filter((v) => v.chemin.startsWith('/v3/tours/photo/')),
    ).toHaveLength(2);
    expect(vi.mocked(uploadObject)).toHaveBeenCalledTimes(2);
  });

  it('M1.5b/releve_fil_photo_absente_ou_illisible — corps vide ou illisible : rien n’est stocké, la photo est retentée au passage suivant', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const chemin = (id: string) =>
      adressePhotoSimulee('TOUR-1', 'arret-a', id).replace(BASE, '');
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({ photosEnlevement: ['photo-vide', 'photo-illisible'] }),
      },
      // MTS-1 répond 200 avec un corps vide pour une photo qu'il n'a pas.
      [chemin('photo-vide')]: { corps: '' },
      [chemin('photo-illisible')]: { corps: '<html>erreur</html>' },
    });

    await releve(base);

    expect(vi.mocked(uploadObject)).not.toHaveBeenCalled();
    expect(base.de('fichiers', 'insert')).toEqual([]);
    expect(
      base.journal('PHOTO_DOWNLOAD_FAILED').map((a) => a.data!['erreur']),
    ).toEqual([
      'PHOTO_DOWNLOAD_FAILED: absente tourId=TOUR-1 stopId=arret-a photoId=photo-vide',
      'PHOTO_DOWNLOAD_FAILED: tourId=TOUR-1 stopId=arret-a photoId=photo-illisible',
    ]);
    // Non bloquant : les pesées sont écrites, la commande n'est pas en échec.
    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(5);
    expect(base.journal('SYNC_ORDER_FAILED')).toEqual([]);

    // La photo arrive au passage suivant : elle est prise.
    fil.poser(chemin('photo-vide'), {
      corps: JPEG_DE_TEST.toString('base64'),
    });
    await releve(base);
    expect(vi.mocked(uploadObject)).toHaveBeenCalledTimes(1);
    expect(base.de('fichiers', 'insert')).toHaveLength(1);
  });

  it('M1.5b/releve_photos_apres_fin_de_mission — une photo en échec ne retarde ni les pesées ni la fin de mission', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      agregation: 'realisee',
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({ terminee: true, photosEnlevement: ['photo-lente'] }),
      },
      // La photo répond en erreur : elle est tracée, la commande va au bout.
      [adressePhotoSimulee('TOUR-1', 'arret-a', 'photo-lente').replace(
        BASE,
        '',
      )]: { status: 503, corps: '' },
    });

    await releve(base);

    expect(base.etat.tournees[0]!.statut).toBe('terminee');
    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(5);
    expect(base.journal('PHOTO_DOWNLOAD_FAILED')).toHaveLength(1);
    // Les photos viennent après l'agrégation de la collecte.
    const ordre = base.appels
      .filter(
        (a) =>
          a.table === 'fn_agreger_terminal_collecte' ||
          (a.table === 'integrations_logs' &&
            String(a.data?.['erreur']).startsWith('PHOTO_DOWNLOAD_FAILED')),
      )
      .map((a) => a.table);
    expect(ordre).toEqual([
      'fn_agreger_terminal_collecte',
      'integrations_logs',
    ]);
    expect(base.journal('SYNC_ORDER_FAILED')).toEqual([]);
  });

  it('M1.5b/releve_fil_photo_arret_commun — la photo d’un dépôt commun à plusieurs commandes n’est pas prise', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const tour = tourA({ photosEnlevement: ['photo-enlevement'] });
    tour.stops![1] = {
      ...tour.stops![1]!,
      // Le dépôt nomme aussi une autre commande, d'une autre collecte possible.
      customerOrders: [
        { customerOrderId: 'CMD-A' },
        { customerOrderId: 'CMD-AUTRE' },
      ],
      photos: [
        {
          downloadUrl: adressePhotoSimulee(
            'TOUR-1',
            'arret-a-depot',
            'photo-depot',
          ),
        },
      ],
    };
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tour },
      [adressePhotoSimulee('TOUR-1', 'arret-a', 'photo-enlevement').replace(
        BASE,
        '',
      )]: { corps: JPEG_DE_TEST.toString('base64') },
    });

    await releve(base);

    expect(
      fil.vus
        .filter((v) => v.chemin.startsWith('/v3/tours/photo/'))
        .map((v) => v.chemin.split('/').at(-1)),
    ).toEqual(['photo-enlevement']);
    expect(base.de('fichiers', 'insert')).toHaveLength(1);
  });

  it('M1.5b/releve_fil_photo_enregistrement_en_echec — un enregistrement de photo refusé laisse une trace', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      erreurEnregistrementFichier: { message: 'connexion perdue' },
    });
    filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({ photosEnlevement: ['photo-enlevement'] }),
      },
      [adressePhotoSimulee('TOUR-1', 'arret-a', 'photo-enlevement').replace(
        BASE,
        '',
      )]: { corps: JPEG_DE_TEST.toString('base64') },
    });

    await releve(base);

    expect(
      base.journal('PHOTO_ENREGISTREMENT_FAILED').map((a) => a.data!['erreur']),
    ).toEqual([
      'PHOTO_ENREGISTREMENT_FAILED: tourId=TOUR-1 stopId=arret-a photoId=photo-enlevement',
    ]);
    expect(base.journal('SYNC_ORDER_FAILED')).toEqual([]);
  });

  it('M1.5b/releve_fil_photo_dedup_en_echec — une recherche de doublon en échec ne télécharge ni n’enregistre rien', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      erreurFichiers: { message: 'connexion perdue' },
    });
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: tourA({ photosEnlevement: ['photo-enlevement'] }),
      },
    });

    await releve(base);

    expect(
      fil.vus.filter((v) => v.chemin.startsWith('/v3/tours/photo/')),
    ).toEqual([]);
    expect(base.de('fichiers', 'insert')).toEqual([]);
    expect(base.journal('PHOTO_DEDUP_FAILED')).toHaveLength(1);
    expect(base.journal('SYNC_ORDER_FAILED')).toEqual([]);
  });

  it('M1.5b/releve_fil_entrees_vides — une entrée vide dans les arrêts, commandes, stuffs ou photos est ignorée', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
      agregation: 'realisee',
    });
    const tour = tourA({ terminee: true });
    const enlevement = tour.stops![0]!;
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'OK', 'TOUR-1')] },
      '/v3/tours/TOUR-1': {
        json: {
          ...tour,
          stops: [
            null,
            {
              ...enlevement,
              customerOrders: [null, ...enlevement.customerOrders!],
              stuffs: [null, ...enlevement.stuffs!],
              photos: [null],
            },
          ],
        },
      },
    });

    await releve(base);

    expect(base.journal('SYNC_ORDER_FAILED')).toEqual([]);
    expect(base.de('pesees_tournees', 'upsert')).toHaveLength(5);
    expect(base.etat.tournees[0]!.statut).toBe('terminee');
    expect(base.journal('PHOTO_ADRESSE_INATTENDUE')).toHaveLength(1);
    expect(fil.chemins()).toEqual([RECHERCHE, '/v3/tours/TOUR-1']);
  });

  it('M1.5b/releve_fil_photo_autre_commande — les photos d’un arrêt qui sert une autre commande ne sont pas prises', async () => {
    const base = baseSimulee({
      collecteStatut: 'en_cours',
      tournees: [TOURNEE_1],
    });
    const tour = tourA();
    tour.stops!.push({
      stopId: 'arret-z',
      stopType: 'CUSTOMER_ORDER',
      customerOrders: [{ customerOrderId: 'CMD-Z' }],
      stuffs: [],
      photos: [
        { downloadUrl: adressePhotoSimulee('TOUR-1', 'arret-z', 'photo-z') },
      ],
    });
    const fil = filSimule({
      [RECHERCHE]: { json: [commande('CMD-A', 'IN_PROGRESSION', 'TOUR-1')] },
      '/v3/tours/TOUR-1': { json: tour },
    });

    await releve(base);

    expect(
      fil.vus.filter((v) => v.chemin.startsWith('/v3/tours/photo/')),
    ).toEqual([]);
    expect(base.de('fichiers', 'insert')).toEqual([]);
  });
});
