// M1.5a — reprise d'un envoi MTS-1 : curseurs, 201 illisible, tournée unitaire.
//
// Toute la chaîne est réelle : runOutboxWorker → AdapterMts1 → Mts1Client. Deux
// frontières simulées, qui gardent chacune leur état d'un passage à l'autre :
//   - la base : tables `tournees` et `collecte_tournees`, la collecte, et
//     l'ordre de la file tel que le rendent ses fonctions (réservation,
//     résultat, reaper) ;
//   - MTS-1 : un faux serveur derrière `fetch`, qui crée commandes et tournées,
//     les rattache, et répond à la recherche comme le compte de démonstration
//     (formes mesurées le 2026-10-13). L'envoi au transporteur et la validation
//     restent simulés : c'est par eux que se verrait un appel que Savr ne doit
//     pas faire (l'Admin regroupe et envoie les tournées dans la console MTS-1,
//     décision Val 2026-10-15).
//
// Chaque test joue une panne au premier passage, puis laisse le worker
// reprendre l'ordre tel que la file le lui rend, drapeau « à réconcilier »
// compris. Ce qui est prouvé : combien de commandes et de tournées existent chez
// MTS-1 à la fin, où sont les commandes, et qu'aucune tournée n'a été envoyée
// au transporteur ni validée par Savr.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSlackSink } from '@savr/shared/src/alerting/slack.js';

import { runOutboxWorker } from '../outbox-worker.js';

const COLLECTE_ID = 'c0000000-0000-0000-0000-0000000000c1';
const PRESTA_ID = 'aa000000-0000-0000-0000-0000000000a1';
const NUMERO_RANG_1 = `${COLLECTE_ID}-1`;

type Reponse = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
const BASE_KO: Reponse = {
  data: null,
  error: { message: 'connexion à la base perdue' },
};

interface Tournee {
  id: string;
  reference_interne: string;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
  prestataire_logistique_id: string | null;
  [colonne: string]: unknown;
}

// ─── Base simulée ─────────────────────────────────────────────────────────────

function fausseBase(
  opts: { nbCamions?: number; ordre?: 'creation' | 'modification' } = {},
) {
  const tournees: Tournee[] = [];
  const liens: Array<{
    collecte_id: string;
    tournee_id: string;
    rang: number;
  }> = [];
  const ordre = {
    statut: 'pending',
    attempts: 0,
    requires_reconciliation: false,
    last_error: null as string | null,
    repriseAuPassage: 0,
  };
  const resultats: Array<Record<string, unknown>> = [];
  // Pannes à jouer une fois chacune, sur la première requête qui correspond
  // (après en avoir laissé passer `apres`).
  const pannes: Array<{
    table: string;
    op: string;
    si?: (donnees: Record<string, unknown>) => boolean;
    apres: number;
  }> = [];
  let resultatsPerdus = 0;
  let passage = 0;

  const collecteRow = {
    id: COLLECTE_ID,
    type: 'zero_dechet',
    date_collecte: '2027-03-20',
    heure_collecte: '22:00:00',
    nb_camions_demande: opts.nbCamions ?? 1,
    statut: 'programmee',
    statut_tms: 'non_envoye',
    tms_reference: null as string | null,
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    prestataire_logistique_id: PRESTA_ID,
    lieu_overrides: null,
    evenement: {
      contact_principal_nom: 'Alice Martin',
      contact_principal_telephone: '+33600000001',
      contact_secours_nom: null,
      contact_secours_telephone: null,
      lieux: {
        id: 'lieu-001',
        nom: 'Lieu',
        adresse_acces: '1 rue Test',
        code_postal: '75001',
        ville: 'Paris',
        latitude: null,
        longitude: null,
        acces_details: null,
        type_vehicule_max: 'fourgon',
        contraintes_horaires: null,
      },
    },
  };
  const transporteurRow = {
    id: 'transp-001',
    type_tms: 'mts1',
    code_transporteur_mts1: 'STRIKE',
    prestataire_logistique_id: PRESTA_ID,
  };

  function requete(table: string) {
    let op = 'select';
    let donnees: Record<string, unknown> = {};
    const filtres: Record<string, unknown> = {};
    const filtresIn: Record<string, unknown[]> = {};
    const garde = (ligne: Record<string, unknown>) =>
      Object.entries(filtres).every(([col, val]) => ligne[col] === val);

    const executer = (): Reponse => {
      const panne = pannes.find(
        (p) => p.table === table && p.op === op && (!p.si || p.si(donnees)),
      );
      if (panne && panne.apres-- <= 0) {
        pannes.splice(pannes.indexOf(panne), 1);
        return BASE_KO;
      }
      if (table === 'collectes') {
        // Une écriture n'est appliquée que si ses filtres `.in()` la laissent
        // passer (garde de statut des écritures de l'adapter).
        if (
          op === 'update' &&
          Object.entries(filtresIn).every(([col, vals]) =>
            vals.includes((collecteRow as Record<string, unknown>)[col]),
          )
        ) {
          Object.assign(collecteRow, donnees);
        }
        return { data: op === 'select' ? [collecteRow] : null, error: null };
      }
      if (table === 'transporteurs') {
        return { data: [transporteurRow].filter(garde), error: null };
      }
      if (table === 'collecte_tournees') {
        if (op === 'upsert') {
          const lien = donnees as (typeof liens)[number];
          const i = liens.findIndex(
            (l) => l.collecte_id === lien.collecte_id && l.rang === lien.rang,
          );
          if (i >= 0) liens[i] = lien;
          else liens.push(lien);
          return { data: null, error: null };
        }
        // Lecture avec la tournée embarquée, comme la rend PostgREST.
        return {
          data: liens.filter(garde).map((l) => ({
            rang: l.rang,
            tournees: { ...tournees.find((t) => t.id === l.tournee_id) },
          })),
          error: null,
        };
      }
      if (table === 'tournees') {
        if (op === 'upsert') {
          let ligne = tournees.find(
            (t) => t.reference_interne === donnees['reference_interne'],
          );
          if (ligne) Object.assign(ligne, donnees);
          else {
            ligne = {
              id: `tournee-${tournees.length + 1}`,
              tms_reference: null,
              ...donnees,
            } as Tournee;
            tournees.push(ligne);
          }
          return { data: [{ ...ligne }], error: null };
        }
        if (op === 'update') {
          const touchees = tournees.filter(garde);
          for (const t of touchees) Object.assign(t, donnees);
          return { data: touchees.map((t) => ({ ...t })), error: null };
        }
        if (op === 'select') {
          return {
            data: tournees.filter(garde).map((t) => ({ ...t })),
            error: null,
          };
        }
      }
      return { data: null, error: null };
    };

    const une = async (): Promise<Reponse> => {
      const r = executer();
      if (r.error) return r;
      return {
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: null,
      };
    };

    const q: Record<string, unknown> = {};
    for (const m of ['select', 'not', 'gte', 'limit', 'order']) {
      q[m] = () => q;
    }
    q['in'] = (col: string, vals: unknown[]) => {
      filtresIn[col] = vals;
      return q;
    };
    q['eq'] = (col: string, val: unknown) => {
      filtres[col] = val;
      return q;
    };
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      q[m] = (d?: Record<string, unknown>) => {
        op = m;
        donnees = d ?? {};
        return q;
      };
    }
    q['single'] = une;
    q['maybeSingle'] = une;
    q['then'] = (
      resolve: (r: Reponse) => unknown,
      reject: (e: unknown) => unknown,
    ) => Promise.resolve(executer()).then(resolve, reject);
    return q;
  }

  const rpc = vi.fn(async (nom: string, args: Record<string, unknown> = {}) => {
    if (nom === 'fn_reap_outbox_claims') {
      passage++;
      // Le reaper : une réservation restée « en cours » repart, à réconcilier.
      if (ordre.statut !== 'processing') return { data: 0, error: null };
      ordre.statut = 'pending';
      ordre.requires_reconciliation = true;
      return { data: 1, error: null };
    }
    if (nom === 'fn_claim_outbox_batch') {
      const reservable =
        ordre.statut === 'pending' ||
        (ordre.statut === 'failed' && passage >= ordre.repriseAuPassage);
      if (!reservable) return { data: [], error: null };
      ordre.statut = 'processing';
      ordre.attempts++;
      return {
        data: [
          {
            id: 'evt-1',
            aggregate_type: 'collecte',
            aggregate_id: COLLECTE_ID,
            event_type:
              opts.ordre === 'modification'
                ? 'collecte.modifiee'
                : 'collecte.creee',
            payload: { collecte_id: COLLECTE_ID },
            consumer: 'adapter_mts1',
            attempts: ordre.attempts,
            requires_reconciliation: ordre.requires_reconciliation,
          },
        ],
        error: null,
      };
    }
    if (nom === 'fn_result_outbox') {
      if (resultatsPerdus > 0) {
        resultatsPerdus--;
        return BASE_KO;
      }
      resultats.push(args);
      ordre.statut = String(args['p_statut']);
      ordre.last_error = (args['p_last_error'] as string | undefined) ?? null;
      // Un échec ne se reprend qu'à un passage ultérieur (palier de reprise).
      ordre.repriseAuPassage = passage + 1;
      // Le drapeau est collant : une fois levé, seul l'aboutissement le solde.
      if (args['p_requires_reconciliation'] === true) {
        ordre.requires_reconciliation = true;
      }
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });

  const supabase = {
    rpc,
    from: (table: string) => requete(table),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;

  return {
    supabase,
    collecte: collecteRow,
    tournees,
    liens,
    ordre,
    resultats,
    /**
     * La prochaine requête `op` sur `table` (qui satisfait `si`) échoue, après en
     * avoir laissé passer `apres`.
     */
    casser: (
      table: string,
      op: string,
      si?: (donnees: Record<string, unknown>) => boolean,
      apres = 0,
    ) => pannes.push({ table, op, si, apres }),
    /** Les `n` prochaines écritures du résultat de l'ordre échouent. */
    perdreResultats: (n: number) => {
      resultatsPerdus = n;
    },
    /**
     * Pose la ligne `tournees` d'un rang et son lien. Par défaut : commandée,
     * sans tournée chez MTS-1, envoi non terminé.
     */
    poserTournee: (rang: number, colonnes: Partial<Tournee> = {}) => {
      const id = `tournee-${tournees.length + 1}`;
      tournees.push({
        id,
        reference_interne: `TMS-${COLLECTE_ID}-${rang}`,
        external_ref_commande: `CMD-${rang}`,
        tms_reference: null,
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_ID,
        ...colonnes,
      });
      liens.push({ collecte_id: COLLECTE_ID, tournee_id: id, rang });
    },
  };
}

// ─── MTS-1 simulé (faux serveur derrière fetch) ───────────────────────────────

type Panne = 'corps_illisible' | 'sans_identifiant' | 'filtre_ignore' | 503;

function fauxMts1() {
  const commandes: Array<{
    customerOrderId: string;
    orderNumber: string;
    tourId: string | null;
    /** Statut rendu par la recherche ; « DRAFT » par défaut. */
    statut?: string;
  }> = [];
  const tours: Array<{ tourId: string; envois: number; validations: number }> =
    [];
  const appels: string[] = [];
  const pannes: Array<{ route: string; panne: Panne }> = [];

  const reponse = (status: number, corps: unknown, illisible = false) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (illisible ? '<html>' : JSON.stringify(corps)),
    json: async () => {
      if (illisible) throw new SyntaxError('Unexpected token < in JSON');
      return corps;
    },
  });

  const fetchMock = vi.fn(
    async (url: string, init: { method: string; body?: string }) => {
      const { pathname, search, searchParams } = new URL(url);
      const route = `${init.method} ${pathname}`;
      appels.push(route + decodeURIComponent(search));
      const i = pannes.findIndex((p) => p.route === route);
      const panne = i >= 0 ? pannes.splice(i, 1)[0]!.panne : null;
      // Refus : rien n'est créé ni modifié chez MTS-1.
      if (typeof panne === 'number') {
        return reponse(panne, { error: 'UNAVAILABLE' });
      }
      const corps = (init.body ? JSON.parse(init.body) : {}) as Record<
        string,
        string
      >;

      if (route === 'POST /v3/customerOrders') {
        const commande = {
          customerOrderId: `CMD-${commandes.length + 1}`,
          orderNumber: corps['orderNumber']!,
          tourId: null,
        };
        commandes.push(commande);
        // À partir d'ici la commande EXISTE, quoi que dise la réponse.
        if (panne === 'corps_illisible') return reponse(201, null, true);
        if (panne === 'sans_identifiant') return reponse(201, {});
        return reponse(201, {
          customerOrderId: commande.customerOrderId,
          orderNumber: commande.orderNumber,
          customerOrderStatus: 'DRAFT',
        });
      }
      if (route === 'GET /v3/customerOrders') {
        const ids = searchParams.get('customerOrderIds')?.split(',');
        const numero = searchParams.get('orderNumber');
        return reponse(
          200,
          commandes
            .filter(
              (c) =>
                // Filtre ignoré : toutes les commandes du compte sont rendues.
                panne === 'filtre_ignore' ||
                (ids
                  ? ids.includes(c.customerOrderId)
                  : c.orderNumber === numero),
            )
            .map((c) => ({
              customerOrderId: c.customerOrderId,
              orderNumber: c.orderNumber,
              customerOrderStatus: c.statut ?? 'DRAFT',
              orderDate: '2027-03-20T21:00:00.000Z',
              // Formes mesurées le 2026-10-13 : l'objet existe toujours, sans
              // `tourId` ni `stopId` tant que la commande n'est rattachée à
              // aucune tournée.
              currentTour: c.tourId
                ? {
                    tourId: c.tourId,
                    stopId: 'STOP-1',
                    tourDate: '2027-03-20T21:00:00.000Z',
                    scheduleId: 'SCH-1',
                  }
                : { tourDate: '2027-03-20T21:00:00.000Z', scheduleId: 'SCH-1' },
            })),
        );
      }
      if (route === 'POST /v3/tours') {
        const tour = {
          tourId: `TOUR-${tours.length + 1}`,
          envois: 0,
          validations: 0,
        };
        tours.push(tour);
        // À partir d'ici la tournée EXISTE, quoi que dise la réponse.
        if (panne === 'corps_illisible') return reponse(201, null, true);
        if (panne === 'sans_identifiant') return reponse(201, {});
        return reponse(201, { tourId: tour.tourId });
      }
      if (route === 'PUT /v3/tours/addCustomerOrder') {
        const commande = commandes.find(
          (c) => c.customerOrderId === corps['customerOrderId'],
        );
        if (commande) commande.tourId = corps['tourId']!;
        return reponse(200, {});
      }
      // Modification d'une commande (ordre « collecte.modifiee »).
      if (/^PUT \/v3\/customerOrders\/.+$/.test(route)) return reponse(200, {});
      // Envoi au transporteur et validation : Savr ne doit pas les appeler
      // (l'Admin regroupe et envoie les tournées dans la console MTS-1).
      // Simulés pour qu'un appel se voie.
      const envoi = route.match(/^POST \/v3\/dispatch\/(.+)\/toCarrier$/);
      if (envoi) {
        tours.find((t) => t.tourId === envoi[1])!.envois++;
        return reponse(201, {});
      }
      const validation = route.match(/^PUT \/v3\/tours\/(.+)\/validate$/);
      if (validation) {
        tours.find((t) => t.tourId === validation[1])!.validations++;
        return reponse(200, {});
      }
      return reponse(404, { error: 'BAD_ROUTE' });
    },
  );
  vi.stubGlobal('fetch', fetchMock as never);

  return {
    commandes,
    tours,
    appels,
    /** Le prochain appel de cette route subit la panne. */
    casser: (route: string, panne: Panne) => pannes.push({ route, panne }),
    /** Appels reçus dont la route commence par `debut`. */
    recus: (debut: string) => appels.filter((a) => a.startsWith(debut)),
    /** Rang déjà mené à terme chez MTS-1 : commande rattachée, tournée envoyée et validée. */
    poserCamionEnvoye: (rang: number) => {
      commandes.push({
        customerOrderId: `CMD-${rang}`,
        orderNumber: `${COLLECTE_ID}-${rang}`,
        tourId: `TOUR-${rang}`,
      });
      tours.push({ tourId: `TOUR-${rang}`, envois: 1, validations: 1 });
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('M1.5a / reprise d’un envoi MTS-1', () => {
  let mts1: ReturnType<typeof fauxMts1>;

  beforeEach(() => {
    vi.stubEnv('MTS1_BASE_URL', 'https://mts1.test');
    vi.stubEnv('MTS1_API_KEY', 'k');
    setSlackSink(async () => {});
    mts1 = fauxMts1();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    setSlackSink(async () => {});
  });

  /** Envois au transporteur et validations : Savr ne doit jamais les faire. */
  const envoisOuValidations = () =>
    mts1.appels.filter((a) => /\/v3\/dispatch\/|\/validate$/.test(a));

  /**
   * Un seul camion : une commande, une tournée unitaire où elle est rattachée,
   * une seule fois, ni envoyée au transporteur ni validée — l'Admin regroupe et
   * envoie dans la console MTS-1 (décision Val 2026-10-15). Curseurs écrits, la
   * collecte affiche l'identifiant de la commande et attend sa tournée.
   */
  function attendreUnSeulCamion(base: ReturnType<typeof fausseBase>) {
    expect(mts1.commandes.map((c) => [c.customerOrderId, c.tourId])).toEqual([
      ['CMD-1', 'TOUR-1'],
    ]);
    expect(mts1.tours).toEqual([
      { tourId: 'TOUR-1', envois: 0, validations: 0 },
    ]);
    expect(envoisOuValidations()).toEqual([]);
    expect(base.liens).toHaveLength(1);
    expect(base.tournees).toHaveLength(1);
    expect(base.tournees[0]).toMatchObject({
      external_ref_commande: 'CMD-1',
      tms_reference: 'TOUR-1',
      statut: 'planifiee',
    });
    expect(base.collecte).toMatchObject({
      tms_reference: 'CMD-1',
      statut_tms: 'a_attribuer',
    });
    expect(base.ordre.statut).toBe('done');
  }

  describe('curseur non écrit après une création', () => {
    it('M1.5a/reprise_lien_non_ecrit — le lien collecte ↔ tournée n’est pas écrit après le 201 : ordre à réconcilier, la reprise retrouve la commande et n’en crée pas une seconde', async () => {
      const base = fausseBase();
      base.casser('collecte_tournees', 'upsert');

      const premier = await runOutboxWorker(base.supabase);

      expect(premier).toMatchObject({ claimed: 1, done: 0, failed: 1 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : commande CMD-1 (lien de la tournée, rang 1) non enregistrée côté Savr — connexion à la base perdue',
      });
      // Rien n'est allé plus loin que la commande.
      expect(mts1.tours).toHaveLength(0);

      const second = await runOutboxWorker(base.supabase);

      expect(second).toMatchObject({ claimed: 1, done: 1, failed: 0 });
      // La commande est retrouvée par son numéro, pas recréée.
      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${NUMERO_RANG_1}`,
      ]);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_ligne_tournee_non_ecrite — la ligne `tournees` n’est pas écrite après le 201 : ordre en reprise à réconcilier (et non en échec définitif), une seule commande', async () => {
      const base = fausseBase();
      base.casser('tournees', 'upsert');

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : commande CMD-1 (rang 1) non enregistrée côté Savr — connexion à la base perdue',
      });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_reference_tournee_non_ecrite — la référence de la tournée n’est pas écrite après le 201 : la commande y est rattachée avant l’erreur, la reprise retrouve la tournée sur la commande et n’en crée pas une seconde', async () => {
      const base = fausseBase();
      base.casser('tournees', 'update', (d) => 'tms_reference' in d);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : tournée TOUR-1 (commande CMD-1 rattachée) non enregistrée côté Savr — connexion à la base perdue',
      });
      expect(mts1.commandes[0]).toMatchObject({ tourId: 'TOUR-1' });
      expect(base.tournees[0]!.tms_reference).toBeNull();

      await runOutboxWorker(base.supabase);

      // La tournée est lue sur la commande, par son identifiant.
      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        'GET /v3/customerOrders?customerOrderIds=CMD-1',
      ]);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      // Un seul rattachement : celui d'avant l'erreur.
      expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_tournee_non_creee — 503 à la création de la tournée : à la reprise, la commande est relue, sa tournée est créée et elle y est rattachée', async () => {
      const base = fausseBase();
      mts1.casser('POST /v3/tours', 503);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({ p_statut: 'failed' });
      expect(mts1.tours).toHaveLength(0);

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        'GET /v3/customerOrders?customerOrderIds=CMD-1',
      ]);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_rattachement_interrompu — 503 au rattachement, la tournée déjà enregistrée : à la reprise, la commande est rattachée à cette tournée, aucune autre n’est créée', async () => {
      const base = fausseBase();
      mts1.casser('PUT /v3/tours/addCustomerOrder', 503);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({ p_statut: 'failed' });
      expect(base.tournees[0]!.tms_reference).toBe('TOUR-1');
      expect(mts1.commandes[0]!.tourId).toBeNull();

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_rang_reattribue_commande_non_ecrite — rang refusé puis réattribué : la commande n’est pas écrite sur sa tournée réinitialisée ; ordre à réconcilier, la reprise la retrouve sous le numéro de la tentative', async () => {
      const base = fausseBase();
      base.poserTournee(1, {
        reference_interne: `TMS-${COLLECTE_ID}-1-r2`,
        external_ref_commande: null,
      });
      base.casser('tournees', 'update', (d) => 'external_ref_commande' in d);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : commande CMD-1 (rang 1) non enregistrée côté Savr — connexion à la base perdue',
      });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${NUMERO_RANG_1}-r2`,
      ]);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_resultat_non_ecrit — base injoignable : ni le lien ni le résultat de l’ordre ne sont écrits ; l’ordre repris par le reaper est à réconcilier, une seule commande', async () => {
      const base = fausseBase();
      base.casser('collecte_tournees', 'upsert');
      base.perdreResultats(1);

      await runOutboxWorker(base.supabase);

      // Rien n'a été écrit sur l'ordre : il est resté réservé.
      expect(base.resultats).toHaveLength(0);
      expect(base.ordre.statut).toBe('processing');

      const second = await runOutboxWorker(base.supabase);

      expect(second).toMatchObject({ reaped: 1, done: 1 });
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_multi_camions_lien_rang_2 — deux camions, le lien du second n’est pas écrit : la reprise ne recrée ni la commande du premier, ni celle du second', async () => {
      const base = fausseBase({ nbCamions: 2 });
      base.casser('collecte_tournees', 'upsert', (d) => d['rang'] === 2);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
      });

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.commandes.map((c) => [c.orderNumber, c.tourId])).toEqual([
        [`${COLLECTE_ID}-1`, 'TOUR-1'],
        [`${COLLECTE_ID}-2`, 'TOUR-2'],
      ]);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 0, validations: 0 },
        { tourId: 'TOUR-2', envois: 0, validations: 0 },
      ]);
      expect(envoisOuValidations()).toEqual([]);
    });
  });

  describe('201 dont l’identifiant est illisible', () => {
    it.each([
      ['corps_illisible', 'un corps qui n’est pas du JSON'],
      ['sans_identifiant', 'un corps sans customerOrderId'],
    ] as const)(
      'M1.5a/reprise_201_commande_%s — POST /v3/customerOrders répond 201 avec %s : ordre à réconcilier, la reprise retrouve la commande et n’en crée pas une seconde',
      async (panne, _cas) => {
        const base = fausseBase();
        mts1.casser('POST /v3/customerOrders', panne);

        await runOutboxWorker(base.supabase);

        expect(base.resultats[0]).toMatchObject({
          p_statut: 'failed',
          p_requires_reconciliation: true,
          p_last_error:
            'MTS-1 POST /v3/customerOrders : création acceptée, mais « customerOrderId » est illisible dans la réponse',
        });
        // La commande existe chez MTS-1, et Savr n'en a rien enregistré.
        expect(mts1.commandes).toHaveLength(1);
        expect(base.tournees).toHaveLength(0);

        await runOutboxWorker(base.supabase);

        expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
        attendreUnSeulCamion(base);
      },
    );

    it.each([
      ['corps_illisible', 'un corps qui n’est pas du JSON'],
      ['sans_identifiant', 'un corps sans tourId'],
    ] as const)(
      'M1.5a/reprise_201_tournee_%s_limite — POST /v3/tours répond 201 avec %s : ordre à réconcilier ; la première tournée reste vide, la reprise en crée une autre et y rattache la commande',
      async (panne, _cas) => {
        const base = fausseBase();
        mts1.casser('POST /v3/tours', panne);

        await runOutboxWorker(base.supabase);

        expect(base.resultats[0]).toMatchObject({
          p_statut: 'failed',
          p_requires_reconciliation: true,
          p_last_error:
            'MTS-1 POST /v3/tours : création acceptée, mais « tourId » est illisible dans la réponse',
        });

        await runOutboxWorker(base.supabase);

        // Limite connue : rattachée à rien, la première tournée ne se retrouve
        // pas ; elle reste vide dans la console, sans transporteur.
        expect(mts1.commandes.map((c) => c.tourId)).toEqual(['TOUR-2']);
        expect(mts1.tours.map((t) => t.tourId)).toEqual(['TOUR-1', 'TOUR-2']);
        expect(base.tournees[0]!.tms_reference).toBe('TOUR-2');
        expect(envoisOuValidations()).toEqual([]);
      },
    );
  });

  describe('commande déjà enregistrée, tournée absente côté Savr', () => {
    it('M1.5a/reprise_commande_enregistree — la commande est relue : dans aucune tournée, sa tournée unitaire est créée et elle y est rattachée', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: null,
      });
      base.ordre.requires_reconciliation = true;

      await runOutboxWorker(base.supabase);

      expect(mts1.appels).toEqual([
        'GET /v3/customerOrders?customerOrderIds=CMD-1',
        'POST /v3/tours',
        'PUT /v3/tours/addCustomerOrder',
      ]);
      attendreUnSeulCamion(base);
    });

    it.each([
      [
        'qu’aucune ligne ne porte : elle devient celle du camion',
        false,
        'TOUR-9',
      ],
      [
        'qu’une autre ligne porte (regroupement) : rien n’est enregistré',
        true,
        null,
      ],
    ] as const)(
      'M1.5a/reprise_commande_dans_tournee_admin — la commande est déjà dans une tournée de la console %s ; rien n’est créé ni rattaché',
      async (_cas, porteeAilleurs, attendue) => {
        const base = fausseBase();
        base.poserTournee(1);
        if (porteeAilleurs) {
          base.tournees.push({
            id: 'tournee-autre-collecte',
            reference_interne: 'TMS-autre-collecte-1',
            external_ref_commande: 'CMD-AUTRE',
            tms_reference: 'TOUR-9',
            statut: 'planifiee',
            prestataire_logistique_id: PRESTA_ID,
          });
        }
        mts1.commandes.push({
          customerOrderId: 'CMD-1',
          orderNumber: NUMERO_RANG_1,
          tourId: 'TOUR-9',
        });
        mts1.tours.push({ tourId: 'TOUR-9', envois: 0, validations: 0 });

        await runOutboxWorker(base.supabase);

        expect(base.ordre.statut).toBe('done');
        expect(mts1.appels).toEqual([
          'GET /v3/customerOrders?customerOrderIds=CMD-1',
        ]);
        expect(mts1.commandes[0]!.tourId).toBe('TOUR-9');
        expect(base.tournees[0]!.tms_reference).toBe(attendue);
      },
    );
  });

  describe('ordre « à réconcilier » sans rien d’enregistré', () => {
    it('M1.5a/reprise_commande_rendue_deux_fois — la recherche rend deux fois le même identifiant, d’abord sous un autre numéro et sur une tournée : c’est la commande au bon numéro qui est reprise, la tournée de l’autre n’est ni adoptée ni touchée', async () => {
      const base = fausseBase();
      base.ordre.requires_reconciliation = true;
      mts1.tours.push({ tourId: 'TOUR-X', envois: 1, validations: 1 });
      mts1.commandes.push(
        {
          customerOrderId: 'CMD-1',
          orderNumber: 'autre-collecte-1',
          tourId: 'TOUR-X',
        },
        { customerOrderId: 'CMD-1', orderNumber: NUMERO_RANG_1, tourId: null },
      );
      mts1.casser('GET /v3/customerOrders', 'filtre_ignore');

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(0);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-X', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 0, validations: 0 },
      ]);
      expect(base.tournees[0]).toMatchObject({
        external_ref_commande: 'CMD-1',
        tms_reference: 'TOUR-2',
      });
    });

    it('M1.5a/reprise_commande_retrouvee_avec_sa_tournee — la commande retrouvée par son numéro est déjà dans une tournée : les deux sont reprises en une seule lecture, rien n’est créé', async () => {
      const base = fausseBase();
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-1',
      });
      mts1.tours.push({ tourId: 'TOUR-1', envois: 0, validations: 0 });

      await runOutboxWorker(base.supabase);

      expect(mts1.appels).toEqual([
        `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${NUMERO_RANG_1}`,
      ]);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_commande_identifiant_hors_alphabet — la commande retrouvée par son numéro porte un identifiant à caractères de chemin : elle n’est pas adoptée, aucune commande n’est créée à sa place, l’ordre repart en reprise', async () => {
      const base = fausseBase();
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1/../CMD-9',
        orderNumber: NUMERO_RANG_1,
        tourId: null,
      });

      const result = await runOutboxWorker(base.supabase);

      expect(result).toMatchObject({ failed: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_last_error: `LogistiqueTransientError: MTS-1 GET /v3/customerOrders : réponse inattendue, customerOrderId illisible pour le numéro ${NUMERO_RANG_1}`,
      });
      // Aucune ligne `tournees` ne porte cet identifiant, et la recherche est le
      // seul appel parti : ni commande créée, ni appel sur l'identifiant rendu.
      expect(base.tournees).toHaveLength(0);
      expect(mts1.appels).toEqual([
        `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${NUMERO_RANG_1}`,
      ]);
    });

    it('M1.5a/reprise_commande_doublon_identifiant_hors_alphabet — deux commandes du même numéro, celle que le départage retient porte un identifiant hors alphabet : la reprise s’arrête, l’autre commande n’est pas adoptée à sa place', async () => {
      const base = fausseBase();
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push(
        { customerOrderId: 'CMD-1', orderNumber: NUMERO_RANG_1, tourId: null },
        // « . » se trie avant « C » : c'est cet identifiant que le départage
        // (le plus petit) retient.
        {
          customerOrderId: '../CMD-9',
          orderNumber: NUMERO_RANG_1,
          tourId: null,
        },
      );

      const result = await runOutboxWorker(base.supabase);

      expect(result).toMatchObject({ failed: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_last_error: `LogistiqueTransientError: MTS-1 GET /v3/customerOrders : réponse inattendue, customerOrderId illisible pour le numéro ${NUMERO_RANG_1}`,
      });
      expect(base.tournees).toHaveLength(0);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(0);
    });

    it.each(['OK', 'PARTIAL', 'ARCHIVED'] as const)(
      'M1.5a/reprise_commande_terminee — une commande du même numéro est déjà « %s » chez MTS-1 : échec définitif, ni reprise ni nouvelle création',
      async (statut) => {
        const base = fausseBase();
        base.ordre.requires_reconciliation = true;
        mts1.commandes.push({
          customerOrderId: 'CMD-1',
          orderNumber: NUMERO_RANG_1,
          tourId: 'TOUR-1',
          statut,
        });
        mts1.tours.push({ tourId: 'TOUR-1', envois: 1, validations: 1 });

        const result = await runOutboxWorker(base.supabase);

        expect(result).toMatchObject({ dead: 1, done: 0 });
        expect(base.resultats[0]).toMatchObject({
          p_statut: 'dead',
          p_last_error: `collecte ${COLLECTE_ID} : une commande du numéro ${NUMERO_RANG_1} est déjà terminée chez MTS-1 (CMD-1 ${statut}) — ni reprise ni nouvelle création`,
        });
        // Une seule lecture, aucune écriture chez MTS-1 ; rien d'enregistré
        // côté Savr.
        expect(mts1.appels).toEqual([
          `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${NUMERO_RANG_1}`,
        ]);
        expect(mts1.commandes).toHaveLength(1);
        expect(base.tournees).toHaveLength(0);
      },
    );

    it('M1.5a/reprise_commande_terminee_et_en_cours — une commande terminée ET une commande en cours du même numéro : échec définitif, la commande en cours n’est pas reprise', async () => {
      const base = fausseBase();
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push(
        { customerOrderId: 'CMD-1', orderNumber: NUMERO_RANG_1, tourId: null },
        {
          customerOrderId: 'CMD-2',
          orderNumber: NUMERO_RANG_1,
          tourId: 'TOUR-1',
          statut: 'OK',
        },
      );
      mts1.tours.push({ tourId: 'TOUR-1', envois: 1, validations: 1 });

      const result = await runOutboxWorker(base.supabase);

      expect(result).toMatchObject({ dead: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'dead',
        p_last_error: expect.stringContaining(
          'est déjà terminée chez MTS-1 (CMD-2 OK)',
        ),
      });
      expect(mts1.recus('POST ')).toHaveLength(0);
      expect(mts1.recus('PUT ')).toHaveLength(0);
      expect(base.tournees).toHaveLength(0);
    });

    it('M1.5a/reprise_commande_absente_creation — aucune commande chez MTS-1 : elle est créée avec sa tournée, sans relire la commande créée à l’instant', async () => {
      const base = fausseBase();
      base.ordre.requires_reconciliation = true;

      await runOutboxWorker(base.supabase);

      // Une seule lecture : la recherche par numéro, avant la création.
      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${NUMERO_RANG_1}`,
      ]);
      attendreUnSeulCamion(base);
    });
  });

  describe('ajout d’un camion par une modification', () => {
    /**
     * Collecte passée de 1 à 2 camions : le premier a sa commande et sa tournée,
     * envoyée et validée par l'Admin dans la console.
     */
    function ajoutDUnCamion() {
      const base = fausseBase({ nbCamions: 2, ordre: 'modification' });
      base.poserTournee(1, { tms_reference: 'TOUR-1' });
      base.collecte.tms_reference = 'CMD-1';
      base.collecte.statut_tms = 'acceptee';
      mts1.poserCamionEnvoye(1);
      return base;
    }

    /**
     * Deux commandes, chacune dans sa tournée ; celle du premier camion n'est pas
     * touchée, celle du second n'est ni envoyée ni validée, et la collecte revient
     * « à attribuer » tant que le second camion attend (le moins avancé l'emporte).
     */
    function attendreDeuxCamions(base: ReturnType<typeof fausseBase>) {
      expect(base.ordre.statut).toBe('done');
      expect(mts1.commandes.map((c) => [c.customerOrderId, c.tourId])).toEqual([
        ['CMD-1', 'TOUR-1'],
        ['CMD-2', 'TOUR-2'],
      ]);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 0, validations: 0 },
      ]);
      expect(envoisOuValidations()).toEqual([]);
      expect(base.tournees.map((t) => t.tms_reference)).toEqual([
        'TOUR-1',
        'TOUR-2',
      ]);
      expect(base.collecte).toMatchObject({
        tms_reference: 'CMD-1',
        statut_tms: 'a_attribuer',
      });
    }

    it('M1.5a/reprise_ajout_camion_lien_non_ecrit — le lien du nouveau camion n’est pas écrit : la reprise retrouve sa commande, deux camions en tout', async () => {
      const base = ajoutDUnCamion();
      base.casser('collecte_tournees', 'upsert', (d) => d['rang'] === 2);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
      });

      await runOutboxWorker(base.supabase);

      // La commande du nouveau camion est retrouvée par son numéro.
      expect(mts1.recus('GET /v3/customerOrders?minDate=2027-03-19')).toEqual([
        `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${COLLECTE_ID}-2`,
      ]);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      attendreDeuxCamions(base);
    });

    it('M1.5a/ajout_camion_mission_commencee — camion ajouté à une collecte en cours : sa commande et sa tournée partent, le statut logistique de la collecte ne redescend pas', async () => {
      const base = ajoutDUnCamion();
      base.collecte.statut = 'en_cours';

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.commandes.map((c) => [c.customerOrderId, c.tourId])).toEqual([
        ['CMD-1', 'TOUR-1'],
        ['CMD-2', 'TOUR-2'],
      ]);
      expect(base.collecte.statut_tms).toBe('acceptee');
    });

    it('M1.5a/reprise_ajout_camion_rang_servi_sans_reference — un camion dont la commande est déjà dans une tournée, sans référence côté Savr : la modification reprend cette tournée, sans en créer ni rattacher', async () => {
      const base = fausseBase({ nbCamions: 1, ordre: 'modification' });
      base.poserTournee(1);
      mts1.poserCamionEnvoye(1);

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.appels).toEqual([
        'PUT /v3/customerOrders/CMD-1',
        'GET /v3/customerOrders?customerOrderIds=CMD-1',
      ]);
      expect(base.tournees[0]!.tms_reference).toBe('TOUR-1');
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 1, validations: 1 },
      ]);
    });

    it.each(['terminee', 'annulee'] as const)(
      'M1.5a/reprise_modification_rang_clos_non_repris — une modification ne reprend pas un rang dont la tournée est « %s », même sans référence : aucune tournée créée ni rattachée',
      async (statut) => {
        const base = fausseBase({ nbCamions: 1, ordre: 'modification' });
        base.poserTournee(1, { statut });
        mts1.poserCamionEnvoye(1);

        await runOutboxWorker(base.supabase);

        expect(base.ordre.statut).toBe('done');
        expect(mts1.appels).toEqual(['PUT /v3/customerOrders/CMD-1']);
        expect(mts1.tours).toEqual([
          { tourId: 'TOUR-1', envois: 1, validations: 1 },
        ]);
      },
    );

    it('M1.5a/reprise_ajout_camion_rang_servi_non_rejoue — témoin : à la reprise d’une modification, un camion dont la commande et la tournée sont enregistrées n’est ni recommandé ni rattaché', async () => {
      const base = fausseBase({ nbCamions: 2, ordre: 'modification' });
      base.poserTournee(1, { tms_reference: 'TOUR-1' });
      base.poserTournee(2, { tms_reference: 'TOUR-2' });
      mts1.poserCamionEnvoye(1);
      mts1.poserCamionEnvoye(2);

      await runOutboxWorker(base.supabase);

      // Seules les deux modifications de commande partent.
      expect(mts1.appels).toEqual([
        'PUT /v3/customerOrders/CMD-1',
        'PUT /v3/customerOrders/CMD-2',
      ]);
      expect(base.ordre.statut).toBe('done');
    });

    it.each(['CANCELED', 'OK'] as const)(
      'M1.5a/modification_commande_close_sans_tournee — la commande du camion est « %s » chez MTS-1 et sa tournée manque : la modification ne lui crée ni tournée ni rattachement',
      async (statut) => {
        const base = fausseBase({ nbCamions: 1, ordre: 'modification' });
        base.poserTournee(1);
        mts1.commandes.push({
          customerOrderId: 'CMD-1',
          orderNumber: NUMERO_RANG_1,
          tourId: null,
          statut,
        });

        await runOutboxWorker(base.supabase);

        expect(base.ordre.statut).toBe('done');
        expect(mts1.appels).toEqual([
          'PUT /v3/customerOrders/CMD-1',
          'GET /v3/customerOrders?customerOrderIds=CMD-1',
        ]);
        expect(mts1.tours).toEqual([]);
      },
    );

    it('M1.5a/modification_apres_regroupement — l’Admin a regroupé la commande du camion dans une autre tournée : une modification ne la sort pas de cette tournée', async () => {
      const base = fausseBase({ nbCamions: 1, ordre: 'modification' });
      base.poserTournee(1, { tms_reference: 'TOUR-1' });
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-9',
      });
      mts1.tours.push(
        { tourId: 'TOUR-1', envois: 0, validations: 0 },
        { tourId: 'TOUR-9', envois: 1, validations: 1 },
      );

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.appels).toEqual(['PUT /v3/customerOrders/CMD-1']);
      expect(mts1.commandes[0]!.tourId).toBe('TOUR-9');
    });
  });

  describe('témoin : erreur passagère, curseurs écrits', () => {
    it('M1.5a/reprise_reference_collecte_non_ecrite — la référence de la collecte n’est pas écrite après la commande et la tournée : erreur passagère, reprise sans recherche, une seule commande et une seule tournée', async () => {
      const base = fausseBase();
      base.casser('collectes', 'update', (d) => 'tms_reference' in d);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({ p_statut: 'failed' });
      expect(base.resultats[0]!['p_requires_reconciliation']).toBeUndefined();
      expect(base.collecte.tms_reference).toBeNull();

      await runOutboxWorker(base.supabase);

      // La commande est relue par son identifiant, jamais cherchée par numéro.
      expect(mts1.recus('GET /v3/customerOrders?minDate')).toHaveLength(0);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_passagere_depuis_les_curseurs — le statut « à attribuer » n’est pas écrit après la commande et la tournée : reprise sans réconciliation ni recherche, depuis les curseurs', async () => {
      const base = fausseBase();
      base.casser('collectes', 'update', (d) => 'statut_tms' in d);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({ p_statut: 'failed' });
      expect(base.resultats[0]!['p_requires_reconciliation']).toBeUndefined();
      expect(base.collecte.statut_tms).toBe('non_envoye');

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('GET /v3/customerOrders?minDate')).toHaveLength(0);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });
  });
});
