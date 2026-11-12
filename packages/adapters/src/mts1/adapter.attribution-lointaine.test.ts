// Relève MTS-1 — attribution lointaine (décision Val 2026-11-12, C4).
//
// La relève proche ne lit que J−3 à J+2 : une collecte attribuée et acceptée
// dans la console MTS-1 cinq jours avant restait « À attribuer » sur sa fiche
// jusqu'à J−2. Au-delà de la relève proche et jusqu'à J+30, la relève relit le
// transporteur et l'attribution des seules collectes pas encore acceptées.
//
// La mémoire du dernier état vu (integrations_inbox, purgée à 7 jours sur
// created_at) est rajeunie quand elle est relue : sans quoi une collecte remise
// « en attente d'acceptation » par une modification de créneau repasserait
// « acceptée » une semaine après l'acceptation d'origine.
//
// Base simulée à ÉTAT, qui APPLIQUE les filtres de la requête des collectes.
// Codes et identifiants inventés.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CODE_MTS1_BIS,
  PRESTA_MANUEL,
  PRESTA_MTS1,
  PRESTA_MTS1_BIS,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder, Mts1Tour } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// Relève proche jusqu'au 21/03/2027 (jour de Paris), lointaine jusqu'au 20/04.
const FENETRE = {
  depuis: new Date('2027-03-18T00:00:00Z'),
  jusqu_a: new Date('2027-03-21T00:00:00Z'),
  attribution_jusqu_a: new Date('2027-04-20T00:00:00Z'),
};

const ADAPTER = {
  id: 'transp-strike',
  type_tms: 'mts1' as const,
  code_transporteur_mts1: 'CA_STRIKE',
  prestataire_logistique_id: PRESTA_MTS1,
};

const JOUR_MS = 24 * 60 * 60 * 1000;

type Ligne = Record<string, unknown>;

interface CollecteSimulee {
  id: string;
  date_collecte: string;
  statut: string;
  statut_tms: string;
  prestataire_logistique_id: string;
  tournee: {
    id: string;
    statut: string;
    tms_reference: string | null;
    external_ref_commande: string;
    prestataire_logistique_id: string;
  };
}

function collecte(
  id: string,
  date: string,
  champs: Partial<Omit<CollecteSimulee, 'id' | 'tournee'>> = {},
  tournee: Partial<CollecteSimulee['tournee']> = {},
): CollecteSimulee {
  return {
    id,
    date_collecte: date,
    statut: 'programmee',
    statut_tms: 'a_attribuer',
    prestataire_logistique_id: PRESTA_MTS1,
    ...champs,
    tournee: {
      id: `t-${id}`,
      statut: 'planifiee',
      tms_reference: `TOUR-${id}`,
      external_ref_commande: `CMD-${id}`,
      prestataire_logistique_id: PRESTA_MTS1,
      ...tournee,
    },
  };
}

function baseSimulee(
  collectes: CollecteSimulee[],
  options: { erreurCollectes?: boolean } = {},
) {
  const inbox = new Map<
    string,
    { id: string; payload: Ligne; created_at: string }
  >();
  const journal: string[] = [];

  function executer(
    table: string,
    op: string,
    data: Ligne,
    filtres: Array<[string, string, unknown]>,
  ): { data: unknown; error: { code?: string; message: string } | null } {
    const valeur = (col: string) =>
      filtres.find(([, c]) => c === col)?.[2] as unknown;
    if (table === 'flux_dechets' || table === 'parametres_algo') {
      return { data: [], error: null };
    }
    if (table === 'integrations_logs') {
      journal.push(String(data['erreur']));
      return { data: null, error: null };
    }
    if (table === 'integrations_inbox') {
      if (op === 'insert') {
        const cle = data['event_id_externe'] as string;
        if (inbox.has(cle)) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value' },
          };
        }
        inbox.set(cle, {
          id: `inbox-${inbox.size + 1}`,
          payload: (data['payload'] as Ligne) ?? {},
          created_at: new Date().toISOString(),
        });
        return { data: null, error: null };
      }
      if (op === 'update') {
        for (const ligne of inbox.values()) {
          if (ligne.id !== valeur('id')) continue;
          if (data['payload']) ligne.payload = data['payload'] as Ligne;
          if (data['created_at']) ligne.created_at = String(data['created_at']);
        }
        return { data: null, error: null };
      }
      const ligne = inbox.get(valeur('event_id_externe') as string);
      return { data: ligne ? [ligne] : [], error: null };
    }
    if (table === 'collecte_tournees') {
      const c = collectes.find((x) => x.id === valeur('collecte_id'));
      return {
        data: c
          ? [
              {
                rang: 1,
                tournees: { ...c.tournee, reference_interne: `TMS-${c.id}-1` },
              },
            ]
          : [],
        error: null,
      };
    }
    if (table === 'tournees' && op === 'update') {
      const c = collectes.find((x) => x.tournee.id === valeur('id'));
      if (c) Object.assign(c.tournee, data);
      return { data: null, error: null };
    }
    if (table === 'collectes') {
      const retenues = collectes.filter((c) =>
        filtres.every(([op2, col, val]) => {
          const v = (c as unknown as Ligne)[col];
          if (op2 === 'eq') return v === val;
          if (op2 === 'in') return (val as unknown[]).includes(v);
          if (op2 === 'gt') return String(v) > String(val);
          if (op2 === 'lte') return String(v) <= String(val);
          return true;
        }),
      );
      if (op === 'update') {
        for (const c of retenues) Object.assign(c, data);
        return { data: retenues.map((c) => ({ id: c.id })), error: null };
      }
      if (options.erreurCollectes) {
        return { data: null, error: { message: 'base indisponible' } };
      }
      return {
        data: retenues
          .sort((a, b) => a.date_collecte.localeCompare(b.date_collecte))
          .map((c) => ({
            id: c.id,
            statut: c.statut,
            statut_tms: c.statut_tms,
            prestataire_logistique_id: c.prestataire_logistique_id,
            collecte_tournees: [{ rang: 1, tournees: { ...c.tournee } }],
          })),
        error: null,
      };
    }
    return { data: null, error: null };
  }

  function requete(table: string) {
    let op = 'select';
    let data: Ligne = {};
    const filtres: Array<[string, string, unknown]> = [];
    const resoudre = () => Promise.resolve(executer(table, op, data, filtres));
    const filtre = (nom: string) => (c: string, v: unknown) => (
      filtres.push([nom, c, v]),
      b
    );
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (d: Ligne) => ((op = 'insert'), (data = d), b),
      update: (d: Ligne) => ((op = 'update'), (data = d), b),
      eq: filtre('eq'),
      in: filtre('in'),
      gt: filtre('gt'),
      lte: filtre('lte'),
      order: () => b,
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
    rpc: () => {
      const r = { data: null, error: null };
      return {
        single: () => Promise.resolve(r),
        then: (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok),
      };
    },
  };
  return { supabase: supabase as never, inbox, journal };
}

function commande(id: string, tourId?: string, statut = 'VALIDATED') {
  return {
    customerOrderId: id,
    orderNumber: `numero-${id}`,
    customerOrderStatus: statut,
    orderDate: '2027-03-26T07:00:00.000Z',
    currentTour: tourId ? { tourId } : {},
  } as Mts1CustomerOrder;
}

function tournee(tourId: string, dispatch: string, transporteur?: string) {
  return {
    tourId,
    status: { dispatch, validation: 'VALIDATED' },
    stops: [],
    ...(transporteur
      ? { dispatch: { carrierShareableCode: transporteur } }
      : {}),
  } as Mts1Tour;
}

/** MTS-1 simulé : la relève proche ne rend rien, les commandes se lisent par identifiant. */
function armer(
  commandes: Mts1CustomerOrder[],
  tours: Record<string, Mts1Tour>,
  surGetTour?: () => void,
) {
  const parId = new Map(commandes.map((c) => [c.customerOrderId, c]));
  const handlers = {
    pollOrders: vi.fn(async () => []),
    getTour: vi.fn(async (id: string) => {
      surGetTour?.();
      return tours[id] ?? ({} as Mts1Tour);
    }),
    findOrdersByIds: vi.fn(async (ids: string[]) =>
      ids.flatMap((id) => (parId.has(id) ? [parId.get(id)!] : [])),
    ),
    postOrder: vi.fn(),
  };
  _setMts1Handlers(handlers);
  return handlers;
}

const relever = (
  base: ReturnType<typeof baseSimulee>,
  fenetre: {
    depuis: Date;
    jusqu_a: Date;
    attribution_jusqu_a?: Date;
  } = FENETRE,
) => new AdapterMts1(ADAPTER, base.supabase).sync(fenetre);

afterEach(() => {
  _setMts1Handlers(null);
  vi.useRealTimers();
});

describe('Relève MTS-1 — attribution lointaine (J+3 à J+30)', () => {
  it('attribution_lointaine_acceptee — collecte à J+5, tournée acceptée dans la console : « acceptée » et transporteur reporté', async () => {
    const c = collecte('col-1', '2027-03-26');
    const base = baseSimulee([c]);
    armer([commande('CMD-col-1', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'ACCEPTED', CODE_MTS1_BIS),
    });

    await relever(base);

    expect(c.statut_tms).toBe('acceptee');
    expect(c.prestataire_logistique_id).toBe(PRESTA_MTS1_BIS);
    expect(c.tournee.prestataire_logistique_id).toBe(PRESTA_MTS1_BIS);
  });

  it('attribution_lointaine_proposee — tournée seulement proposée : « en attente d’acceptation »', async () => {
    const c = collecte('col-1', '2027-03-26');
    const base = baseSimulee([c]);
    armer([commande('CMD-col-1', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'PROPOSED'),
    });

    await relever(base);

    expect(c.statut_tms).toBe('attribuee_en_attente_acceptation');
  });

  it('attribution_lointaine_sans_borne — sans borne lointaine, rien n’est relu au-delà de la relève proche', async () => {
    const c = collecte('col-1', '2027-03-26');
    const base = baseSimulee([c]);
    const mts1 = armer([commande('CMD-col-1', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'ACCEPTED'),
    });

    await relever(base, { depuis: FENETRE.depuis, jusqu_a: FENETRE.jusqu_a });

    expect(c.statut_tms).toBe('a_attribuer');
    expect(mts1.findOrdersByIds).not.toHaveBeenCalled();
    expect(mts1.getTour).not.toHaveBeenCalled();
  });

  it.each([
    [
      'déjà acceptée',
      collecte('col-1', '2027-03-26', { statut_tms: 'acceptee' }),
    ],
    ['au-delà de J+30', collecte('col-1', '2027-04-21')],
    ['dans la relève proche', collecte('col-1', '2027-03-21')],
    ['annulée', collecte('col-1', '2027-03-26', { statut: 'annulee' })],
    [
      'confiée à un prestataire hors MTS-1',
      collecte('col-1', '2027-03-26', {
        prestataire_logistique_id: PRESTA_MANUEL,
      }),
    ],
  ])(
    'attribution_lointaine_hors_cible — collecte %s : jamais lue chez MTS-1',
    async (_cas, c) => {
      const base = baseSimulee([c]);
      const avant = c.statut_tms;
      const mts1 = armer([commande('CMD-col-1', 'TOUR-X')], {
        'TOUR-X': tournee('TOUR-X', 'PROPOSED'),
      });

      await relever(base);

      expect(mts1.findOrdersByIds).not.toHaveBeenCalled();
      expect(mts1.getTour).not.toHaveBeenCalled();
      expect(c.statut_tms).toBe(avant);
    },
  );

  it('attribution_lointaine_commande_refusee — commande refusée chez MTS-1 : rien n’en est conclu ici', async () => {
    const c = collecte('col-1', '2027-03-26', {
      statut_tms: 'attribuee_en_attente_acceptation',
    });
    const base = baseSimulee([c]);
    const mts1 = armer([commande('CMD-col-1', 'TOUR-X', 'CANCELED')], {
      'TOUR-X': tournee('TOUR-X', 'ACCEPTED'),
    });

    await relever(base);

    expect(mts1.getTour).not.toHaveBeenCalled();
    expect(c.statut_tms).toBe('attribuee_en_attente_acceptation');
  });

  it.each([
    [
      'confiée à un prestataire hors MTS-1',
      { prestataire_logistique_id: PRESTA_MANUEL },
    ],
    ['au numéro de commande illisible', { external_ref_commande: 'CMD col/1' }],
  ])(
    'attribution_lointaine_tournee_ecartee — tournée %s : jamais lue chez MTS-1, rien de réécrit',
    async (_cas, champs) => {
      const c = collecte('col-1', '2027-03-26', {}, champs);
      const base = baseSimulee([c]);
      const avant = { ...c.tournee };
      const mts1 = armer(
        [commande(c.tournee.external_ref_commande, 'TOUR-X')],
        { 'TOUR-X': tournee('TOUR-X', 'ACCEPTED', CODE_MTS1_BIS) },
      );

      await relever(base);

      expect(mts1.findOrdersByIds).not.toHaveBeenCalled();
      expect(mts1.getTour).not.toHaveBeenCalled();
      expect(c.statut_tms).toBe('a_attribuer');
      expect(c.tournee).toEqual(avant);
    },
  );

  it('attribution_lointaine_tournee_illisible — tournée désignée par MTS-1 illisible : jamais lue, rien n’en est conclu', async () => {
    const c = collecte('col-1', '2027-03-26', {
      statut_tms: 'attribuee_en_attente_acceptation',
    });
    const base = baseSimulee([c]);
    const mts1 = armer([commande('CMD-col-1', '../TOUR')], {});

    await relever(base);

    expect(mts1.findOrdersByIds).toHaveBeenCalledTimes(1);
    expect(mts1.getTour).not.toHaveBeenCalled();
    expect(c.statut_tms).toBe('attribuee_en_attente_acceptation');
  });

  it('attribution_lointaine_commandes_par_lots — 60 collectes : commandes lues en 2 appels de 50 au plus', async () => {
    const collectes = Array.from({ length: 60 }, (_, i) =>
      collecte(`col-${String(i).padStart(2, '0')}`, '2027-03-26'),
    );
    const base = baseSimulee(collectes);
    const mts1 = armer(
      collectes.map((c) => commande(c.tournee.external_ref_commande)),
      {},
    );

    await relever(base);

    expect(mts1.findOrdersByIds).toHaveBeenCalledTimes(2);
    expect(mts1.findOrdersByIds.mock.calls.map(([ids]) => ids.length)).toEqual([
      50, 10,
    ]);
  });

  it('attribution_lointaine_echeance — passé 45 s de passage, plus rien n’est commencé : la plus lointaine attend', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-19T10:00:00Z'));
    const proche = collecte('col-a', '2027-03-23');
    const lointaine = collecte('col-b', '2027-04-10');
    const base = baseSimulee([lointaine, proche]);
    const mts1 = armer(
      [commande('CMD-col-a', 'TOUR-A'), commande('CMD-col-b', 'TOUR-B')],
      {
        'TOUR-A': tournee('TOUR-A', 'ACCEPTED'),
        'TOUR-B': tournee('TOUR-B', 'ACCEPTED'),
      },
      () => vi.setSystemTime(Date.now() + 50_000),
    );

    await relever(base);

    expect(mts1.getTour).toHaveBeenCalledTimes(1);
    expect(proche.statut_tms).toBe('acceptee');
    expect(lointaine.statut_tms).toBe('a_attribuer');
  });

  it('attribution_lointaine_non_bloquante — collectes illisibles : la relève proche aboutit, une trace', async () => {
    const base = baseSimulee([collecte('col-1', '2027-03-26')], {
      erreurCollectes: true,
    });
    armer([], {});

    await expect(relever(base)).resolves.toBeUndefined();

    expect(
      base.journal.filter((l) => l.startsWith('SYNC_ATTRIBUTION_FAILED:')),
    ).toHaveLength(1);
  });
});

describe('Relève MTS-1 — mémoire d’attribution entretenue malgré la purge à 7 jours', () => {
  it('memoire_reacceptation — collecte remise en attente après une modification, tournée toujours acceptée et déjà vue : reste « en attente »', async () => {
    const c = collecte('col-1', '2027-03-26', {
      statut_tms: 'attribuee_en_attente_acceptation',
    });
    const base = baseSimulee([c]);
    base.inbox.set('mts1:attribution:CMD-col-1', {
      id: 'inbox-memoire',
      payload: { etat: 'TOUR-X:2' },
      created_at: new Date().toISOString(),
    });
    armer([commande('CMD-col-1', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'ACCEPTED'),
    });

    await relever(base);

    expect(c.statut_tms).toBe('attribuee_en_attente_acceptation');
  });

  it.each([
    ['vieille de 4 jours', 4, true],
    ['vieille d’un jour', 1, false],
  ])(
    'memoire_rajeunie — mémoire %s relue au même état : rajeunie seulement au-delà de 3 jours',
    async (_cas, jours, rajeunie) => {
      const c = collecte('col-1', '2027-03-26', {
        statut_tms: 'attribuee_en_attente_acceptation',
      });
      const base = baseSimulee([c]);
      const creeeLe = new Date(Date.now() - jours * JOUR_MS).toISOString();
      base.inbox.set('mts1:attribution:CMD-col-1', {
        id: 'inbox-memoire',
        payload: { etat: 'TOUR-X:2' },
        created_at: creeeLe,
      });
      armer([commande('CMD-col-1', 'TOUR-X')], {
        'TOUR-X': tournee('TOUR-X', 'ACCEPTED'),
      });

      await relever(base);

      const apres = base.inbox.get('mts1:attribution:CMD-col-1')!.created_at;
      if (rajeunie) {
        expect(Date.now() - Date.parse(apres)).toBeLessThan(60_000);
      } else {
        expect(apres).toBe(creeeLe);
      }
    },
  );
});
