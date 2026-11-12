// Notifications MTS-1, étape 2 (décision Val 2026-11-12, C3) : une notification
// est un signal. Les commandes qu'elle désigne sont relues chez MTS-1 et traitées
// comme par la relève, quelle que soit leur date ; une notification de tournée
// seule (`tour/update`, mesuré le 2026-11-12) désigne les commandes nommées sur
// les arrêts de la tournée.
//
// Base simulée à ÉTAT (même forme que adapter.attribution-transporteur.test.ts).
// Codes et identifiants inventés.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CODE_MTS1_BIS,
  PRESTA_MTS1,
  PRESTA_MTS1_BIS,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { releverNotificationMts1 } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder, Mts1Tour } from './mock.js';
import { _setMts1Handlers } from './mock.js';

const ADAPTER = {
  id: 'transp-strike',
  type_tms: 'mts1' as const,
  code_transporteur_mts1: 'CA_STRIKE',
  prestataire_logistique_id: PRESTA_MTS1,
};

type Ligne = Record<string, unknown>;

function baseSimulee(init: { statutTms: string; commande?: string }) {
  const etat = {
    collecte: {
      id: 'col-001',
      statut: 'programmee',
      statut_tms: init.statutTms,
      prestataire_logistique_id: PRESTA_MTS1 as string,
    },
    tournee: {
      id: 't1',
      rang: 1,
      reference_interne: 'TMS-col-001-1',
      external_ref_commande: init.commande ?? 'CMD-1',
      tms_reference: 'TOUR-UNITAIRE' as string | null,
      statut: 'planifiee',
      prestataire_logistique_id: PRESTA_MTS1 as string,
    },
    inbox: new Map<string, { id: string; traite: boolean; payload: Ligne }>(),
  };
  const journal: string[] = [];

  function executer(
    table: string,
    op: string,
    data: Ligne,
    f: Ligne,
  ): { data: unknown; error: { code?: string; message: string } | null } {
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
        if (etat.inbox.has(cle)) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value' },
          };
        }
        const ligne = {
          id: `inbox-${etat.inbox.size + 1}`,
          traite: data['traite'] === true,
          payload: (data['payload'] as Ligne) ?? {},
        };
        etat.inbox.set(cle, ligne);
        return { data: [{ id: ligne.id }], error: null };
      }
      if (op === 'update') {
        for (const ligne of etat.inbox.values()) {
          if (ligne.id !== f['id']) continue;
          if (data['traite'] === true) ligne.traite = true;
          if (data['payload']) ligne.payload = data['payload'] as Ligne;
        }
        return { data: null, error: null };
      }
      const ligne = etat.inbox.get(f['event_id_externe'] as string);
      return { data: ligne ? [ligne] : [], error: null };
    }
    if (table === 'tournees') {
      if (op === 'update') {
        if (f['id'] === etat.tournee.id) Object.assign(etat.tournee, data);
        return { data: null, error: null };
      }
      const t =
        etat.tournee.external_ref_commande === f['external_ref_commande']
          ? etat.tournee
          : null;
      return {
        data: t
          ? [
              {
                ...t,
                collecte_tournees: [
                  {
                    collecte_id: etat.collecte.id,
                    rang: t.rang,
                    collectes: { ...etat.collecte },
                  },
                ],
              },
            ]
          : [],
        error: null,
      };
    }
    if (table === 'collecte_tournees') {
      return {
        data: [{ rang: 1, tournees: { ...etat.tournee } }],
        error: null,
      };
    }
    if (table === 'collectes' && op === 'update') {
      const c = etat.collecte as Ligne;
      const passe = Object.entries(f).every(([col, val]) =>
        Array.isArray(val) ? val.includes(c[col]) : c[col] === val,
      );
      if (passe) Object.assign(etat.collecte, data);
      return { data: passe ? [{ id: etat.collecte.id }] : [], error: null };
    }
    return { data: null, error: null };
  }

  function requete(table: string) {
    let op = 'select';
    let data: Ligne = {};
    const f: Ligne = {};
    const resoudre = () => Promise.resolve(executer(table, op, data, f));
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (d: Ligne) => ((op = 'insert'), (data = d), b),
      update: (d: Ligne) => ((op = 'update'), (data = d), b),
      upsert: (d: Ligne) => ((op = 'upsert'), (data = d), b),
      eq: (c: string, v: unknown) => ((f[c] = v), b),
      in: (c: string, v: unknown) => ((f[c] = v), b),
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
  return { supabase: supabase as never, etat, journal };
}

function commande(
  id: string,
  tourId?: string,
  statut: Mts1CustomerOrder['customerOrderStatus'] = 'VALIDATED',
): Mts1CustomerOrder {
  return {
    customerOrderId: id,
    orderNumber: `numero-${id}`,
    customerOrderStatus: statut,
    orderDate: '2027-04-10T21:00:00.000Z',
    currentTour: tourId ? { tourId } : {},
  };
}

function tournee(
  tourId: string,
  dispatch: string,
  options: { transporteur?: string; commandes?: string[] } = {},
): Mts1Tour {
  return {
    tourId,
    status: { dispatch, validation: 'VALIDATED' },
    stops: (options.commandes ?? []).map((c, i) => ({
      stopId: `S-${i}`,
      stopType: 'CUSTOMER_ORDER',
      customerOrders: [{ customerOrderId: c }],
    })),
    ...(options.transporteur
      ? { dispatch: { carrierShareableCode: options.transporteur } }
      : {}),
  } as Mts1Tour;
}

function armer(
  commandes: Mts1CustomerOrder[],
  tours: Record<string, Mts1Tour>,
) {
  const parId = new Map(commandes.map((c) => [c.customerOrderId, c]));
  const handlers = {
    getTour: vi.fn(async (id: string) => tours[id] ?? ({} as Mts1Tour)),
    findOrdersByIds: vi.fn(async (ids: string[]) =>
      ids.flatMap((id) => (parId.has(id) ? [parId.get(id)!] : [])),
    ),
    pollOrders: vi.fn(async () => []),
    postOrder: vi.fn(),
  };
  _setMts1Handlers(handlers);
  return handlers;
}

const relever = (
  base: ReturnType<typeof baseSimulee>,
  signal: { commandes: unknown[]; tournee: unknown },
) => new AdapterMts1(ADAPTER, base.supabase).releverSignal(signal);

afterEach(() => _setMts1Handlers(null));

describe('Notification MTS-1 — relecture de la commande désignée', () => {
  it('M1.5b/notification_relecture_commande — notification de commande, tournée acceptée par un autre transporteur, collecte lointaine : « acceptée » et transporteur reporté', async () => {
    const base = baseSimulee({ statutTms: 'a_attribuer' });
    const mts1 = armer([commande('CMD-1', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'ACCEPTED', {
        transporteur: CODE_MTS1_BIS,
      }),
    });

    await relever(base, { commandes: ['CMD-1'], tournee: 'TOUR-X' });

    expect(mts1.findOrdersByIds).toHaveBeenCalledWith(['CMD-1']);
    expect(base.etat.collecte.statut_tms).toBe('acceptee');
    expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1_BIS);
  });

  it('M1.5b/notification_relecture_tournee — notification de tournée seule : les commandes nommées sur ses arrêts sont relues', async () => {
    const base = baseSimulee({ statutTms: 'a_attribuer' });
    const mts1 = armer([commande('CMD-1', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'PROPOSED', { commandes: ['CMD-1'] }),
    });

    await relever(base, { commandes: [undefined], tournee: 'TOUR-X' });

    expect(mts1.findOrdersByIds).toHaveBeenCalledWith(['CMD-1']);
    expect(base.etat.collecte.statut_tms).toBe(
      'attribuee_en_attente_acceptation',
    );
  });

  it('M1.5b/notification_relecture_contenu_ignore — le contenu de la notification ne fait rien conclure : seul l’état relu chez MTS-1 compte', async () => {
    // La notification dit « dispatché », MTS-1 dit « pas encore envoyée ».
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
    });
    armer([commande('CMD-1', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'TO_BE_DISPATCHED'),
    });

    await relever(base, { commandes: ['CMD-1'], tournee: 'TOUR-X' });

    expect(base.etat.collecte.statut_tms).toBe('a_attribuer');
  });

  it.each([
    ['identifiants illisibles', { commandes: ['CMD 1/x'], tournee: '../T' }],
    ['rien de désigné', { commandes: [undefined], tournee: undefined }],
    ['types inattendus', { commandes: [42, { id: 'x' }], tournee: 7 }],
  ])(
    'M1.5b/notification_relecture_illisible — %s : aucun appel à MTS-1',
    async (_cas, signal) => {
      const base = baseSimulee({ statutTms: 'a_attribuer' });
      const mts1 = armer([commande('CMD-1', 'TOUR-X')], {});

      await relever(base, signal);

      expect(mts1.getTour).not.toHaveBeenCalled();
      expect(mts1.findOrdersByIds).not.toHaveBeenCalled();
      expect(base.etat.collecte.statut_tms).toBe('a_attribuer');
    },
  );

  it('M1.5b/notification_relecture_inconnue — commande inconnue de Savr, ou rendue par MTS-1 sans avoir été demandée : rien n’est écrit', async () => {
    const base = baseSimulee({ statutTms: 'a_attribuer', commande: 'CMD-1' });
    const mts1 = armer([commande('CMD-AUTRE', 'TOUR-X')], {
      'TOUR-X': tournee('TOUR-X', 'ACCEPTED'),
    });
    mts1.findOrdersByIds.mockResolvedValueOnce([
      commande('CMD-AUTRE', 'TOUR-X'),
      commande('CMD-1', 'TOUR-X'),
    ]);

    await relever(base, { commandes: ['CMD-AUTRE'], tournee: null });

    expect(base.etat.collecte.statut_tms).toBe('a_attribuer');
  });

  it('M1.5b/notification_relecture_lot — 60 commandes nommées sur une tournée : 50 relues au plus', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `CMD-${i}`);
    const base = baseSimulee({ statutTms: 'a_attribuer' });
    const mts1 = armer(
      ids.map((id) => commande(id)),
      { 'TOUR-X': tournee('TOUR-X', 'PROPOSED', { commandes: ids }) },
    );

    await relever(base, { commandes: [undefined], tournee: 'TOUR-X' });

    expect(mts1.findOrdersByIds).toHaveBeenCalledTimes(1);
    expect(mts1.findOrdersByIds.mock.calls[0]![0]).toHaveLength(50);
  });

  it('M1.5b/notification_relecture_echec — tournée illisible chez MTS-1 : tracée, sans exception, rien d’écrit', async () => {
    const base = baseSimulee({ statutTms: 'a_attribuer' });
    const mts1 = armer([commande('CMD-1', 'TOUR-1')], {});
    mts1.getTour.mockRejectedValue(new Error('panne'));

    await expect(
      relever(base, { commandes: ['CMD-1'], tournee: null }),
    ).resolves.toBeUndefined();

    expect(
      base.journal.filter((l) => l.startsWith('NOTIFICATION_ORDER_FAILED:')),
    ).toHaveLength(1);
    expect(base.etat.collecte.statut_tms).toBe('a_attribuer');
  });
});

describe('Notification MTS-1 — point d’entrée du webhook', () => {
  it('M1.5b/notification_point_entree — sans transporteur MTS-1 au référentiel, rien n’est relu', async () => {
    const mts1 = armer([commande('CMD-1', 'TOUR-X')], {});
    const vide = {
      from: () => {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          order: () => b,
          limit: () => Promise.resolve({ data: [], error: null }),
        };
        return b;
      },
    };

    await releverNotificationMts1(vide as never, {
      commandes: ['CMD-1'],
      tournee: null,
    });

    expect(mts1.findOrdersByIds).not.toHaveBeenCalled();
  });
});
