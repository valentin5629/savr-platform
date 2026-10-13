// M1.5a — reprise d'un envoi MTS-1 : curseurs, 201 illisible, tournée.
//
// Toute la chaîne est réelle : runOutboxWorker → AdapterMts1 → Mts1Client. Deux
// frontières simulées, qui gardent chacune leur état d'un passage à l'autre :
//   - la base : tables `tournees` et `collecte_tournees`, et l'ordre de la file
//     tel que le rendent ses fonctions (réservation, résultat, reaper) ;
//   - MTS-1 : un faux serveur derrière `fetch`, qui crée commandes et tournées,
//     les rattache, et répond à la recherche comme le compte de démonstration
//     (formes mesurées le 2026-10-13).
//
// Chaque test joue une panne au premier passage, puis laisse le worker
// reprendre l'ordre tel que la file le lui rend, drapeau « à réconcilier »
// compris. Ce qui est prouvé : combien de commandes et de tournées existent
// chez MTS-1 à la fin, et combien ont été envoyées au transporteur.

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
  // Écriture d'un passage voisin, jouée juste après la prochaine lecture des
  // lignes portant une référence de tournée : c'est la course que ferme
  // l'index unique.
  let apresLectureDesPorteuses: (() => void) | null = null;

  const collecteRow = {
    id: COLLECTE_ID,
    type: 'zero_dechet',
    date_collecte: '2027-03-20',
    heure_collecte: '22:00:00',
    nb_camions_demande: opts.nbCamions ?? 1,
    statut_tms: 'non_envoye',
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
          // Index unique partiel `uniq_tournee_par_tms_reference` : une
          // référence de tournée portée par une AUTRE ligne est refusée.
          const reference = donnees['tms_reference'];
          if (
            typeof reference === 'string' &&
            tournees.some(
              (t) => t.tms_reference === reference && !touchees.includes(t),
            )
          ) {
            return {
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "uniq_tournee_par_tms_reference"',
              },
            };
          }
          for (const t of touchees) Object.assign(t, donnees);
          return { data: touchees.map((t) => ({ ...t })), error: null };
        }
        if (op === 'select') {
          const lues = tournees.filter(garde).map((t) => ({ ...t }));
          if ('tms_reference' in filtres && apresLectureDesPorteuses) {
            const ecritureVoisine = apresLectureDesPorteuses;
            apresLectureDesPorteuses = null;
            ecritureVoisine();
          }
          return { data: lues, error: null };
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
    for (const m of ['select', 'in', 'not', 'gte', 'limit', 'order']) {
      q[m] = () => q;
    }
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
    /**
     * `ecriture` est jouée juste après la prochaine lecture des lignes qui
     * portent une référence de tournée : un passage voisin écrit entre la
     * lecture et l'écriture de celui-ci.
     */
    ecrireApresLectureDesPorteuses: (ecriture: () => void) => {
      apresLectureDesPorteuses = ecriture;
    },
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

type Panne =
  | 'corps_illisible'
  | 'sans_identifiant'
  | 'filtre_ignore'
  | 'tour_en_nombre'
  | 'tour_vide'
  | 'identifiant_hors_alphabet'
  | 'identifiant_deja_porte'
  | 500
  | 503;

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
        return reponse(panne, { error: 'INTERNAL_ERROR' });
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
                    // Formes inattendues : identifiant en nombre, ou vide.
                    tourId:
                      panne === 'tour_en_nombre'
                        ? 42
                        : panne === 'tour_vide'
                          ? ''
                          : c.tourId,
                    stopId: 'STOP-1',
                    tourDate: '2027-03-20T21:00:00.000Z',
                    scheduleId: 'SCH-1',
                  }
                : { tourDate: '2027-03-20T21:00:00.000Z', scheduleId: 'SCH-1' },
            })),
        );
      }
      // MTS-1 rend, à la création, l'identifiant d'une tournée qui existe déjà :
      // rien n'est créé.
      if (route === 'POST /v3/tours' && panne === 'identifiant_deja_porte') {
        return reponse(201, { tourId: tours[0]!.tourId });
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
        // L'identifiant de cette tournée porte « : » : hors de l'alphabet adopté.
        if (panne === 'identifiant_hors_alphabet') {
          tour.tourId = `TOUR:${tours.length}`;
        }
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

  /** Un seul camion, commandé et envoyé une seule fois, curseurs écrits. */
  function attendreUnSeulCamion(base: ReturnType<typeof fausseBase>) {
    expect(mts1.commandes).toHaveLength(1);
    expect(mts1.tours).toEqual([
      { tourId: 'TOUR-1', envois: 1, validations: 1 },
    ]);
    expect(base.liens).toHaveLength(1);
    expect(base.tournees).toHaveLength(1);
    expect(base.tournees[0]).toMatchObject({
      external_ref_commande: 'CMD-1',
      tms_reference: 'TOUR-1',
      statut: 'en_cours',
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

    it('M1.5a/reprise_reference_tournee_non_ecrite — la référence de la tournée n’est pas écrite après le 201 : la commande y est rattachée avant l’erreur, la reprise retrouve la tournée par sa commande et n’en crée pas une seconde', async () => {
      const base = fausseBase();
      base.casser('tournees', 'update', (d) => 'tms_reference' in d);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : tournée TOUR-1 (commande CMD-1 rattachée) non enregistrée côté Savr — connexion à la base perdue',
      });
      // La tournée existe, la commande y est rattachée, rien n'est encore parti
      // chez le transporteur.
      expect(mts1.commandes[0]).toMatchObject({ tourId: 'TOUR-1' });
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 0, validations: 0 },
      ]);
      expect(base.tournees[0]!.tms_reference).toBeNull();

      await runOutboxWorker(base.supabase);

      // La tournée est lue sur la commande, par son identifiant.
      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        'GET /v3/customerOrders?customerOrderIds=CMD-1',
      ]);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      // Un seul rattachement en tout : celui d'avant l'erreur. La tournée reprise
      // sur la commande n'est pas rattachée une seconde fois.
      expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_reference_tournee_non_ecrite_deux_fois — la référence de la tournée échoue à deux passages de suite : toujours une seule tournée, un seul rattachement, un seul envoi', async () => {
      const base = fausseBase();
      base.casser('tournees', 'update', (d) => 'tms_reference' in d);
      base.casser('tournees', 'update', (d) => 'tms_reference' in d);

      await runOutboxWorker(base.supabase);
      await runOutboxWorker(base.supabase);

      expect(base.resultats).toHaveLength(2);
      expect(base.resultats[1]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : tournée TOUR-1 (commande CMD-1 rattachée) non enregistrée côté Savr — connexion à la base perdue',
      });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(1);
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
        { tourId: 'TOUR-1', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
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
  });

  describe('ordre « à réconcilier » dont la commande est déjà enregistrée', () => {
    it('M1.5a/reprise_tournee_retrouvee_par_la_commande — la commande porte déjà une tournée chez MTS-1 : elle est reprise, aucun POST /v3/tours', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-1',
      });
      mts1.tours.push({ tourId: 'TOUR-1', envois: 0, validations: 0 });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        'GET /v3/customerOrders?customerOrderIds=CMD-1',
      ]);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(0);
      // Déjà rattachée : le rattachement n'est pas rejoué.
      expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(0);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_tournee_autre_commande_rendue — la lecture par identifiant rend d’autres commandes que celle demandée : aucune n’est prise pour elle, échec définitif, aucune tournée créée ni reprise', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      // Une commande d'une autre collecte, déjà sur une tournée.
      mts1.commandes.push({
        customerOrderId: 'CMD-AUTRE',
        orderNumber: 'autre-collecte-1',
        tourId: 'TOUR-AUTRE',
      });
      mts1.tours.push({ tourId: 'TOUR-AUTRE', envois: 1, validations: 1 });
      mts1.casser('GET /v3/customerOrders', 'filtre_ignore');

      const result = await runOutboxWorker(base.supabase);

      expect(result).toMatchObject({ dead: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'dead',
        p_last_error: expect.stringContaining(
          'commande introuvable chez MTS-1',
        ),
      });
      expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-AUTRE', envois: 1, validations: 1 },
      ]);
      expect(base.tournees[0]!.tms_reference).toBeNull();
    });

    it('M1.5a/reprise_tournee_d_un_autre_rang — deux camions, la commande du second est chez MTS-1 sur la tournée du premier : le second rang ne la reprend pas, il crée la sienne ; la tournée du premier n’est pas renvoyée', async () => {
      const base = fausseBase({ nbCamions: 2 });
      base.poserTournee(1, { tms_reference: 'TOUR-1', statut: 'en_cours' });
      base.poserTournee(2);
      base.ordre.requires_reconciliation = true;
      mts1.poserCamionEnvoye(1);
      mts1.commandes.push({
        customerOrderId: 'CMD-2',
        orderNumber: `${COLLECTE_ID}-2`,
        tourId: 'TOUR-1',
      });

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        'GET /v3/customerOrders?customerOrderIds=CMD-2',
      ]);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
      expect(base.tournees.map((t) => t.tms_reference)).toEqual([
        'TOUR-1',
        'TOUR-2',
      ]);
    });

    it('M1.5a/reprise_tournee_garde_lecture_en_echec — la lecture qui vérifie qu’aucune ligne ne porte déjà cette tournée échoue : rien n’est repris ni créé, l’ordre repart en reprise', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-1',
      });
      mts1.tours.push({ tourId: 'TOUR-1', envois: 0, validations: 0 });
      base.casser('tournees', 'select');

      const premier = await runOutboxWorker(base.supabase);

      expect(premier).toMatchObject({ failed: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_last_error:
          'LogistiqueTransientError: Lecture des tournées portant la référence TOUR-1 échouée — connexion à la base perdue',
      });
      expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
      expect(base.tournees[0]!.tms_reference).toBeNull();

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
      attendreUnSeulCamion(base);
    });

    it('M1.5a/reprise_tournee_d_une_autre_collecte — MTS-1 dit la commande sur une tournée que porte déjà la ligne d’une autre collecte : elle n’est pas reprise, la collecte crée la sienne ; la tournée de l’autre collecte n’est ni renvoyée ni revalidée', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      // Ligne d'une AUTRE collecte, sans lien avec celle de l'ordre.
      base.tournees.push({
        id: 'tournee-A',
        reference_interne: 'TMS-autre-collecte-1',
        external_ref_commande: 'CMD-A',
        tms_reference: 'TOUR-A',
        // Quel que soit son statut : ici, son envoi n'est pas terminé.
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_ID,
      });
      mts1.tours.push({ tourId: 'TOUR-A', envois: 1, validations: 1 });
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-A',
      });

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-A', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
      expect(base.tournees.map((t) => [t.id, t.tms_reference])).toEqual([
        ['tournee-1', 'TOUR-2'],
        ['tournee-A', 'TOUR-A'],
      ]);
    });

    it('M1.5a/reprise_tournee_course_reference_unique — deux reprises simultanées sur la même tournée : la base refuse la seconde référence (index unique), l’ordre repart à réconcilier, puis la collecte crée sa propre tournée ; celle de l’autre collecte n’est ni renvoyée ni revalidée', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      // MTS-1 dit la commande de cette collecte sur TOUR-A.
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-A',
      });
      mts1.tours.push({ tourId: 'TOUR-A', envois: 1, validations: 1 });
      // La course : au moment de la lecture, aucune ligne ne porte TOUR-A ; le
      // passage d'une autre collecte écrit sa référence juste après.
      base.ecrireApresLectureDesPorteuses(() => {
        base.tournees.push({
          id: 'tournee-A',
          reference_interne: 'TMS-autre-collecte-1',
          external_ref_commande: 'CMD-A',
          tms_reference: 'TOUR-A',
          statut: 'en_cours',
          prestataire_logistique_id: PRESTA_ID,
        });
      });

      const premier = await runOutboxWorker(base.supabase);

      expect(premier).toMatchObject({ failed: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : tournée TOUR-A (commande CMD-1 rattachée) non enregistrée côté Savr — duplicate key value violates unique constraint "uniq_tournee_par_tms_reference"',
      });
      // La référence n'est pas écrite deux fois, et rien n'est parti vers la
      // tournée de l'autre collecte : ni rattachement, ni envoi, ni validation.
      expect(base.tournees.map((t) => [t.id, t.tms_reference])).toEqual([
        ['tournee-1', null],
        ['tournee-A', 'TOUR-A'],
      ]);
      expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(0);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-A', envois: 1, validations: 1 },
      ]);

      const second = await runOutboxWorker(base.supabase);

      // À la reprise, la lecture voit la ligne de l'autre collecte : la tournée
      // n'est pas reprise, la collecte crée la sienne et y rattache sa commande
      // (seul rattachement de tout le scénario).
      expect(second).toMatchObject({ done: 1, failed: 0 });
      expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(1);
      expect(mts1.commandes[0]).toMatchObject({ tourId: 'TOUR-2' });
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-A', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
      expect(base.tournees.map((t) => [t.id, t.tms_reference])).toEqual([
        ['tournee-1', 'TOUR-2'],
        ['tournee-A', 'TOUR-A'],
      ]);
    });

    it.each([
      ['tour_en_nombre', 'un nombre'],
      ['tour_vide', 'une chaîne vide'],
    ] as const)(
      'M1.5a/reprise_tournee_identifiant_inattendu (%s) — la commande porte pour identifiant de tournée %s : il n’est ni repris ni lu comme « aucune tournée », aucun POST /v3/tours, l’ordre repart en reprise',
      async (panne, _cas) => {
        const base = fausseBase();
        base.poserTournee(1);
        base.ordre.requires_reconciliation = true;
        mts1.commandes.push({
          customerOrderId: 'CMD-1',
          orderNumber: NUMERO_RANG_1,
          tourId: 'TOUR-1',
        });
        mts1.tours.push({ tourId: 'TOUR-1', envois: 0, validations: 0 });
        mts1.casser('GET /v3/customerOrders', panne);

        const premier = await runOutboxWorker(base.supabase);

        expect(premier).toMatchObject({ failed: 1, done: 0 });
        expect(base.resultats[0]).toMatchObject({
          p_statut: 'failed',
          p_last_error:
            'LogistiqueTransientError: MTS-1 GET /v3/customerOrders : réponse inattendue, currentTour.tourId illisible pour la commande CMD-1',
        });
        expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
        expect(mts1.tours).toEqual([
          { tourId: 'TOUR-1', envois: 0, validations: 0 },
        ]);

        await runOutboxWorker(base.supabase);

        expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
        attendreUnSeulCamion(base);
      },
    );

    it('M1.5a/reprise_tournee_identifiant_hors_alphabet — la commande porte pour identifiant de tournée une chaîne à caractères de chemin : elle n’est ni adoptée ni lue comme « aucune tournée », aucun appel ne part vers elle, l’ordre repart en reprise', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: '../customerOrders/CMD-9',
      });

      const result = await runOutboxWorker(base.supabase);

      expect(result).toMatchObject({ failed: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_last_error:
          'LogistiqueTransientError: MTS-1 GET /v3/customerOrders : réponse inattendue, currentTour.tourId illisible pour la commande CMD-1',
      });
      // Rien n'est écrit, rien n'est créé, rien ne part vers cet identifiant.
      expect(base.tournees[0]!.tms_reference).toBeNull();
      expect(mts1.appels).toEqual([
        'GET /v3/customerOrders?customerOrderIds=CMD-1',
      ]);
    });

    it('M1.5a/reprise_tournee_absente — la commande ne porte aucune tournée : une tournée est créée, une seule', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: null,
      });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });

    it.each(['OK', 'PARTIAL', 'ARCHIVED'] as const)(
      'M1.5a/reprise_curseur_commande_terminee — la commande enregistrée est déjà « %s » chez MTS-1 : échec définitif, sa tournée n’est ni reprise, ni renvoyée, ni recréée',
      async (statut) => {
        const base = fausseBase();
        base.poserTournee(1);
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
          p_last_error: `collecte ${COLLECTE_ID} : la commande du rang 1 (CMD-1) est déjà terminée chez MTS-1 (${statut}) — tournée ni reprise ni créée`,
        });
        // Une seule lecture, aucune écriture chez MTS-1.
        expect(mts1.appels).toEqual([
          'GET /v3/customerOrders?customerOrderIds=CMD-1',
        ]);
        expect(mts1.tours).toEqual([
          { tourId: 'TOUR-1', envois: 1, validations: 1 },
        ]);
        expect(base.tournees[0]!.tms_reference).toBeNull();
      },
    );

    it('M1.5a/reprise_tournee_commande_disparue — la commande n’existe plus chez MTS-1 : échec définitif, aucune tournée créée', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;

      const result = await runOutboxWorker(base.supabase);

      expect(result).toMatchObject({ dead: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'dead',
        p_last_error: `collecte ${COLLECTE_ID} : commande introuvable chez MTS-1 pour le rang 1 (CMD-1) — tournée non créée`,
      });
      expect(mts1.tours).toHaveLength(0);
    });

    it('M1.5a/reprise_tournee_lecture_en_echec — la lecture de la commande répond 500 : jamais lue comme « aucune tournée », aucun POST /v3/tours, l’ordre repart en reprise', async () => {
      const base = fausseBase();
      base.poserTournee(1);
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-1',
      });
      mts1.tours.push({ tourId: 'TOUR-1', envois: 0, validations: 0 });
      mts1.casser('GET /v3/customerOrders', 500);

      const premier = await runOutboxWorker(base.supabase);

      expect(premier).toMatchObject({ failed: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_last_error: expect.stringContaining('MTS-1 500'),
      });
      expect(mts1.recus('POST /v3/tours')).toHaveLength(0);

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
      attendreUnSeulCamion(base);
    });
  });

  describe('ordre « à réconcilier » sans rien d’enregistré', () => {
    it('M1.5a/reprise_commande_rendue_deux_fois — la recherche rend deux fois le même identifiant, d’abord sous un autre numéro et sur une tournée : c’est la commande au bon numéro qui est reprise, la tournée de l’autre n’est pas adoptée', async () => {
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
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
      expect(base.tournees[0]).toMatchObject({
        external_ref_commande: 'CMD-1',
        tms_reference: 'TOUR-2',
      });
    });

    it('M1.5a/reprise_commande_retrouvee_avec_sa_tournee — la commande retrouvée par son numéro porte déjà une tournée : les deux sont reprises en une seule lecture, rien n’est créé', async () => {
      const base = fausseBase();
      base.ordre.requires_reconciliation = true;
      mts1.commandes.push({
        customerOrderId: 'CMD-1',
        orderNumber: NUMERO_RANG_1,
        tourId: 'TOUR-1',
      });
      mts1.tours.push({ tourId: 'TOUR-1', envois: 0, validations: 0 });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('GET /v3/customerOrders')).toEqual([
        `GET /v3/customerOrders?minDate=2027-03-19&maxDate=2027-03-21&orderNumber=${NUMERO_RANG_1}`,
      ]);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(0);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(0);
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

    it('M1.5a/reprise_commande_absente_creation — aucune commande chez MTS-1 : elle est créée, et sa tournée aussi, sans relire la commande créée à l’instant', async () => {
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

  describe('ajout d’un camion par une modification, envoi du nouveau rang interrompu', () => {
    /** Collecte passée de 1 à 2 camions : le premier est déjà mené à terme. */
    function ajoutDUnCamion() {
      const base = fausseBase({ nbCamions: 2, ordre: 'modification' });
      base.poserTournee(1, { tms_reference: 'TOUR-1', statut: 'en_cours' });
      mts1.poserCamionEnvoye(1);
      return base;
    }

    /** Deux camions, chacun commandé, envoyé et validé une seule fois. */
    function attendreDeuxCamions(base: ReturnType<typeof fausseBase>) {
      expect(base.ordre.statut).toBe('done');
      expect(mts1.commandes.map((c) => [c.customerOrderId, c.tourId])).toEqual([
        ['CMD-1', 'TOUR-1'],
        ['CMD-2', 'TOUR-2'],
      ]);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
      expect(base.tournees.map((t) => [t.tms_reference, t.statut])).toEqual([
        ['TOUR-1', 'en_cours'],
        ['TOUR-2', 'en_cours'],
      ]);
    }

    it('M1.5a/reprise_ajout_camion_reference_tournee_non_ecrite — la référence de la tournée du nouveau camion n’est pas écrite : à la reprise de la modification, ce camion est repris et envoyé (il n’est pas tenu pour servi parce que sa commande existe)', async () => {
      const base = ajoutDUnCamion();
      base.casser('tournees', 'update', (d) => 'tms_reference' in d);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : tournée TOUR-2 (commande CMD-2 rattachée) non enregistrée côté Savr — connexion à la base perdue',
      });
      expect(mts1.tours[1]).toEqual({
        tourId: 'TOUR-2',
        envois: 0,
        validations: 0,
      });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      attendreDeuxCamions(base);
    });

    it('M1.5a/reprise_ajout_camion_tournee_non_creee — 503 à la création de la tournée du nouveau camion : à la reprise de la modification, sa tournée est créée et envoyée', async () => {
      const base = ajoutDUnCamion();
      mts1.casser('POST /v3/tours', 503);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({ p_statut: 'failed' });
      expect(mts1.tours).toHaveLength(1);

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      attendreDeuxCamions(base);
    });

    it('M1.5a/reprise_ajout_camion_lien_non_ecrit — le lien du nouveau camion n’est pas écrit : la reprise retrouve sa commande, deux camions envoyés', async () => {
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

    it('M1.5a/reprise_ajout_camion_envoi_503 — 503 à l’envoi au transporteur du nouveau camion, sa référence de tournée déjà écrite : à la reprise de la modification, ce camion est envoyé (il n’est pas tenu pour servi parce que sa tournée a une référence)', async () => {
      const base = ajoutDUnCamion();
      mts1.casser('POST /v3/dispatch/TOUR-2/toCarrier', 503);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({ p_statut: 'failed' });
      expect(base.tournees[1]).toMatchObject({
        tms_reference: 'TOUR-2',
        statut: 'planifiee',
      });

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      attendreDeuxCamions(base);
    });

    it('M1.5a/reprise_ajout_camion_rang_servi_sans_reference — un camion envoyé et validé dont la référence de tournée manque côté Savr reste servi : la modification ne lui crée pas de seconde tournée', async () => {
      const base = fausseBase({ nbCamions: 1, ordre: 'modification' });
      base.poserTournee(1, { tms_reference: null, statut: 'en_cours' });
      mts1.poserCamionEnvoye(1);

      await runOutboxWorker(base.supabase);

      expect(base.ordre.statut).toBe('done');
      expect(mts1.appels).toEqual(['PUT /v3/customerOrders/CMD-1']);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 1, validations: 1 },
      ]);
    });

    it.each(['terminee', 'annulee'] as const)(
      'M1.5a/reprise_modification_rang_clos_non_repris — une modification ne reprend pas un rang dont la tournée est « %s », même sans référence : aucune tournée créée ni envoyée',
      async (statut) => {
        const base = fausseBase({ nbCamions: 1, ordre: 'modification' });
        base.poserTournee(1, { tms_reference: null, statut });
        mts1.poserCamionEnvoye(1);

        await runOutboxWorker(base.supabase);

        expect(base.ordre.statut).toBe('done');
        expect(mts1.appels).toEqual(['PUT /v3/customerOrders/CMD-1']);
        expect(mts1.tours).toEqual([
          { tourId: 'TOUR-1', envois: 1, validations: 1 },
        ]);
      },
    );

    it('M1.5a/reprise_ajout_camion_rang_servi_non_rejoue — témoin : à la reprise d’une modification, un camion déjà mené à terme n’est ni recommandé ni renvoyé', async () => {
      const base = ajoutDUnCamion();
      base.poserTournee(2, { tms_reference: 'TOUR-2', statut: 'en_cours' });
      mts1.poserCamionEnvoye(2);

      await runOutboxWorker(base.supabase);

      // Seules les deux modifications de commande partent.
      expect(mts1.appels).toEqual([
        'PUT /v3/customerOrders/CMD-1',
        'PUT /v3/customerOrders/CMD-2',
      ]);
      attendreDeuxCamions(base);
    });
  });

  describe('témoin : erreur passagère, curseurs écrits', () => {
    it('M1.5a/reprise_passagere_depuis_les_curseurs — 503 à l’envoi au transporteur : reprise sans réconciliation ni recherche, depuis les curseurs', async () => {
      const base = fausseBase();
      mts1.casser('POST /v3/dispatch/TOUR-1/toCarrier', 503);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({ p_statut: 'failed' });
      expect(base.resultats[0]!['p_requires_reconciliation']).toBeUndefined();

      await runOutboxWorker(base.supabase);

      expect(mts1.recus('GET ')).toHaveLength(0);
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      expect(mts1.recus('POST /v3/tours')).toHaveLength(1);
      attendreUnSeulCamion(base);
    });
  });

  // Une tournée créée chez MTS-1 mais jamais rattachée à sa commande ne porte
  // aucun lien vers elle (mesuré le 2026-10-13 : son numéro est attribué par
  // MTS-1, elle n'a aucun arrêt). La reprise ne peut pas la retrouver.
  describe('limite connue : tournée créée, jamais rattachée', () => {
    it.each([
      ['corps_illisible', 'un corps qui n’est pas du JSON'],
      ['sans_identifiant', 'un corps sans tourId'],
    ] as const)(
      'M1.5a/reprise_201_tournee_%s_limite — POST /v3/tours répond 201 avec %s : ordre à réconcilier ; la première tournée reste vide et n’est jamais envoyée au transporteur, la reprise en crée une autre',
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
        // Aucun appel n'est parti avec un identifiant de tournée inconnu.
        expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(0);

        await runOutboxWorker(base.supabase);

        expect(base.ordre.statut).toBe('done');
        expect(mts1.commandes).toHaveLength(1);
        expect(mts1.tours).toEqual([
          { tourId: 'TOUR-1', envois: 0, validations: 0 },
          { tourId: 'TOUR-2', envois: 1, validations: 1 },
        ]);
        expect(base.tournees[0]!.tms_reference).toBe('TOUR-2');
      },
    );

    it('M1.5a/reprise_tournee_creee_reference_deja_portee_limite — POST /v3/tours rend un identifiant qu’une autre ligne porte déjà : l’index refuse la référence, mais la commande est rattachée à cette tournée avant l’erreur ; la reprise crée ensuite sa propre tournée ; celle de l’autre ligne n’est ni renvoyée ni revalidée', async () => {
      const base = fausseBase();
      // La tournée d'une autre collecte, déjà envoyée et validée.
      base.tournees.push({
        id: 'tournee-A',
        reference_interne: 'TMS-autre-collecte-1',
        external_ref_commande: 'CMD-A',
        tms_reference: 'TOUR-A',
        statut: 'en_cours',
        prestataire_logistique_id: PRESTA_ID,
      });
      mts1.tours.push({ tourId: 'TOUR-A', envois: 1, validations: 1 });
      mts1.casser('POST /v3/tours', 'identifiant_deja_porte');

      const premier = await runOutboxWorker(base.supabase);

      expect(premier).toMatchObject({ failed: 1, done: 0 });
      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : tournée TOUR-A (commande CMD-1 rattachée) non enregistrée côté Savr — duplicate key value violates unique constraint "uniq_tournee_par_tms_reference"',
      });
      // La limite : la commande est rattachée à la tournée de l'autre collecte.
      expect(mts1.commandes[0]).toMatchObject({ tourId: 'TOUR-A' });
      // La référence n'est pas écrite deux fois, et rien n'est renvoyé.
      expect(
        base.tournees.find((t) => t.id !== 'tournee-A')!.tms_reference,
      ).toBeNull();
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-A', envois: 1, validations: 1 },
      ]);

      const second = await runOutboxWorker(base.supabase);

      // La reprise ne reprend pas TOUR-A (une ligne la porte) : la collecte crée
      // sa tournée et y rattache sa commande.
      expect(second).toMatchObject({ done: 1, failed: 0 });
      expect(mts1.commandes[0]).toMatchObject({ tourId: 'TOUR-2' });
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-A', envois: 1, validations: 1 },
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
      expect(
        base.tournees.map((t) => [t.external_ref_commande, t.tms_reference]),
      ).toEqual([
        ['CMD-A', 'TOUR-A'],
        ['CMD-1', 'TOUR-2'],
      ]);
    });

    it('M1.5a/reprise_201_tournee_identifiant_hors_alphabet_limite — POST /v3/tours répond 201 avec un identifiant hors de l’alphabet, à chaque tentative : il n’est pas adopté et la commande n’est pas re-postée ; la tournée, rattachée à rien, n’est pas retrouvée, la reprise en crée une autre à chaque passage ; aucune n’est envoyée au transporteur, l’ordre finit en échec définitif', async () => {
      const base = fausseBase();
      for (let i = 0; i < 4; i++) {
        mts1.casser('POST /v3/tours', 'identifiant_hors_alphabet');
      }

      for (let i = 0; i < 4; i++) await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 POST /v3/tours : création acceptée, mais « tourId » est illisible dans la réponse',
      });
      expect(base.ordre.statut).toBe('dead');
      // Une seule commande, adoptée, rattachée à aucune tournée.
      expect(mts1.recus('POST /v3/customerOrders')).toHaveLength(1);
      expect(base.tournees).toHaveLength(1);
      expect(base.tournees[0]).toMatchObject({
        external_ref_commande: 'CMD-1',
        tms_reference: null,
      });
      expect(mts1.commandes[0]!.tourId).toBeNull();
      expect(mts1.recus('PUT /v3/tours/addCustomerOrder')).toHaveLength(0);
      // Une tournée par tentative, toutes vides, aucune envoyée ni validée.
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR:1', envois: 0, validations: 0 },
        { tourId: 'TOUR:2', envois: 0, validations: 0 },
        { tourId: 'TOUR:3', envois: 0, validations: 0 },
        { tourId: 'TOUR:4', envois: 0, validations: 0 },
      ]);
    });

    it('M1.5a/reprise_reference_tournee_et_rattachement_ko_limite — référence non écrite ET rattachement refusé : l’ordre est quand même à réconcilier (l’erreur du rattachement ne masque pas la première) ; la première tournée n’est jamais envoyée', async () => {
      const base = fausseBase();
      base.casser('tournees', 'update', (d) => 'tms_reference' in d);
      mts1.casser('PUT /v3/tours/addCustomerOrder', 503);

      await runOutboxWorker(base.supabase);

      expect(base.resultats[0]).toMatchObject({
        p_statut: 'failed',
        p_requires_reconciliation: true,
        p_last_error:
          'MTS-1 : tournée TOUR-1 (commande CMD-1 NON rattachée) non enregistrée côté Savr — connexion à la base perdue',
      });

      await runOutboxWorker(base.supabase);

      expect(mts1.commandes).toHaveLength(1);
      expect(mts1.tours).toEqual([
        { tourId: 'TOUR-1', envois: 0, validations: 0 },
        { tourId: 'TOUR-2', envois: 1, validations: 1 },
      ]);
    });
  });
});
