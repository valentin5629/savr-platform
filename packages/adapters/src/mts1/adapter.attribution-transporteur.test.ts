// M1.5b — relève MTS-1 : attribution et transporteur lus sur la tournée.
//
// Depuis la décision de Val du 2026-10-15, Savr ne crée que la commande : l'Admin
// compose la tournée dans la console MTS-1 et l'envoie au transporteur. La relève
// lit donc, sur la tournée que désigne la commande (`currentTour.tourId`) :
//   - l'attribution (`status.dispatch`) → statut logistique de la collecte :
//     « à attribuer » tant que la commande n'est dans aucune tournée envoyée,
//     « en attente d'acceptation » quand la tournée est proposée, « acceptée »
//     quand le transporteur l'a acceptée (décision Val 2026-10-13) ; une
//     collecte à plusieurs camions n'est acceptée que quand tous le sont (C47) ;
//   - le transporteur réellement choisi (`dispatch.carrierShareableCode`),
//     reporté sur la fiche (C46).
//
// Base simulée à ÉTAT : deux passages successifs se voient. Codes et
// identifiants inventés.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CODE_MTS1,
  CODE_MTS1_BIS,
  PRESTA_EVEREST,
  PRESTA_MANUEL,
  PRESTA_MTS1,
  PRESTA_MTS1_BIS,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CustomerOrder, Mts1Tour } from './mock.js';
import { _setMts1Handlers } from './mock.js';

const FENETRE = {
  depuis: new Date('2027-03-20T00:00:00Z'),
  jusqu_a: new Date('2027-03-21T00:00:00Z'),
};

const ADAPTER = {
  id: 'transp-strike',
  type_tms: 'mts1' as const,
  code_transporteur_mts1: CODE_MTS1,
  prestataire_logistique_id: PRESTA_MTS1,
};

type Ligne = Record<string, unknown>;

interface Camion {
  id: string;
  rang: number;
  commande: string;
  statut?: string;
  prestataire?: string;
}

type LigneReferentiel = {
  prestataire_logistique_id: string;
  type_tms: string;
  code_transporteur_mts1: string | null;
};

/**
 * Référentiel des transporteurs qui APPLIQUE `.eq()` et `.in()` : le
 * référentiel partagé ignore `.in()`, et ne prouverait donc pas que le
 * transporteur de la console est cherché parmi les seuls transporteurs MTS-1.
 */
function referentielFiltrant(lignes: LigneReferentiel[]) {
  return () => {
    const filtres: Array<(l: LigneReferentiel) => boolean> = [];
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (col: keyof LigneReferentiel, val: unknown) => (
        filtres.push((l) => l[col] === val),
        b
      ),
      in: (col: keyof LigneReferentiel, vals: unknown[]) => (
        filtres.push((l) => vals.includes(l[col])),
        b
      ),
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve({
          data: lignes.filter((l) => filtres.every((f) => f(l))),
          error: null,
        }).then(ok),
    };
    return b;
  };
}

function baseSimulee(init: {
  statut?: string;
  statutTms: string;
  camions: Camion[];
  /** Référentiel des transporteurs ; par défaut le référentiel partagé. */
  referentiel?: LigneReferentiel[];
  /** Prestataire de la collecte ; par défaut un transporteur MTS-1. */
  prestataireCollecte?: string;
}) {
  const DOUBLON = { code: '23505', message: 'duplicate key value' };
  const etat = {
    collecte: {
      id: 'col-001',
      statut: init.statut ?? 'programmee',
      statut_tms: init.statutTms,
      prestataire_logistique_id: init.prestataireCollecte ?? PRESTA_MTS1,
    },
    tournees: init.camions.map((c) => ({
      id: c.id,
      rang: c.rang,
      reference_interne: `TMS-col-001-${c.rang}`,
      external_ref_commande: c.commande,
      tms_reference: null as string | null,
      statut: c.statut ?? 'planifiee',
      prestataire_logistique_id: c.prestataire ?? PRESTA_MTS1,
    })),
    inbox: new Map<string, { id: string; traite: boolean; payload: Ligne }>(),
  };
  const alertes: Ligne[] = [];
  const journal: string[] = [];

  function executer(
    table: string,
    op: string,
    data: Ligne,
    f: Ligne,
  ): {
    data: unknown;
    error: { code?: string; message: string } | null;
  } {
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
        if (etat.inbox.has(cle)) return { data: null, error: DOUBLON };
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
        const t = etat.tournees.find((x) => x.id === f['id']);
        if (t) Object.assign(t, data);
        return { data: null, error: null };
      }
      const t = etat.tournees.find(
        (x) => x.external_ref_commande === f['external_ref_commande'],
      );
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
        data: etat.tournees.map((t) => ({ rang: t.rang, tournees: { ...t } })),
        error: null,
      };
    }
    if (table === 'collectes' && op === 'update') {
      const c = etat.collecte as Ligne;
      const passe = Object.entries(f).every(([col, val]) =>
        col.startsWith('neq:')
          ? c[col.slice(4)] !== val
          : Array.isArray(val)
            ? val.includes(c[col])
            : c[col] === val,
      );
      if (passe) Object.assign(etat.collecte, data);
      // Comme `.select('id')` après l'écriture : les lignes réellement écrites.
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
      neq: (c: string, v: unknown) => ((f[`neq:${c}`] = v), b),
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

  const transporteurs = init.referentiel
    ? referentielFiltrant(init.referentiel)
    : builderTransporteurs;
  const from = (table: string) =>
    table === 'transporteurs' ? transporteurs() : requete(table);
  const supabase = {
    from,
    schema: () => ({ from }),
    rpc: (nom: string, args: Ligne) => {
      if (nom === 'f_upsert_alerte_admin') alertes.push(args);
      const r = { data: 'pending', error: null };
      return {
        single: () => Promise.resolve(r),
        then: (ok: (v: unknown) => unknown) => Promise.resolve(r).then(ok),
      };
    },
  };
  return { supabase: supabase as never, etat, alertes, journal };
}

function commande(id: string, tourId?: string): Mts1CustomerOrder {
  return {
    customerOrderId: id,
    orderNumber: `numero-${id}`,
    customerOrderStatus: 'VALIDATED',
    orderDate: '2027-03-20T21:00:00.000Z',
    // Sans `tourId` tant que la commande n'est dans aucune tournée (forme
    // mesurée le 2026-10-13).
    currentTour: tourId ? { tourId } : {},
  };
}

function tournee(
  tourId: string,
  dispatch: string,
  transporteur?: string,
): Mts1Tour {
  return {
    tourId,
    status: { dispatch, validation: 'VALIDATED' },
    stops: [],
    ...(transporteur
      ? { dispatch: { carrierShareableCode: transporteur } }
      : {}),
  };
}

/**
 * MTS-1 simulé : `lot` = commandes rendues par la relève, `tours` par
 * identifiant, `autres` = commandes que MTS-1 connaît sans que la relève les
 * rende à ce passage (lues par identifiant).
 */
function armer(
  lot: Mts1CustomerOrder[],
  tours: Record<string, Mts1Tour>,
  autres: Mts1CustomerOrder[] = [],
) {
  const toutes = new Map(
    [...lot, ...autres].map((c) => [c.customerOrderId, c]),
  );
  const handlers = {
    pollOrders: vi.fn(async () => lot),
    getTour: vi.fn(async (id: string) => tours[id] ?? {}),
    findOrdersByIds: vi.fn(async (ids: string[]) =>
      ids.flatMap((id) => (toutes.has(id) ? [toutes.get(id)!] : [])),
    ),
    postOrder: vi.fn(),
  };
  _setMts1Handlers(handlers);
  return handlers;
}

const relever = (base: ReturnType<typeof baseSimulee>) =>
  new AdapterMts1(ADAPTER, base.supabase).sync(FENETRE);

afterEach(() => _setMts1Handlers(null));

describe('M1.5b / relève MTS-1 — attribution lue sur la tournée', () => {
  it('M1.5b/attribution_tournee_proposee — la tournée de la commande est proposée au transporteur : « en attente d’acceptation »', async () => {
    const base = baseSimulee({
      statutTms: 'a_attribuer',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'PROPOSED'),
    });

    await relever(base);

    expect(base.etat.collecte.statut_tms).toBe(
      'attribuee_en_attente_acceptation',
    );
  });

  it.each([
    ['acceptée par le transporteur', 'ACCEPTED'],
    ['terminée par le transporteur', 'COMPLETED'],
  ])(
    'M1.5b/attribution_tournee_acceptee — tournée %s : « acceptée »',
    async (_cas, dispatch) => {
      const base = baseSimulee({
        statutTms: 'attribuee_en_attente_acceptation',
        camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      });
      armer([commande('CMD-1', 'TOUR-1')], {
        'TOUR-1': tournee('TOUR-1', dispatch),
      });

      await relever(base);

      expect(base.etat.collecte.statut_tms).toBe('acceptee');
    },
  );

  it('M1.5b/attribution_commande_validee_tournee_proposee — commande VALIDATED sur une tournée seulement proposée (cas mesuré le 2026-10-13) : pas « acceptée »', async () => {
    const base = baseSimulee({
      statutTms: 'acceptee',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'PROPOSED'),
    });

    await relever(base);

    expect(base.etat.collecte.statut_tms).toBe(
      'attribuee_en_attente_acceptation',
    );
  });

  it.each([
    ['dans aucune tournée', undefined],
    ['dans une tournée pas encore envoyée', 'TO_BE_DISPATCHED'],
  ])(
    'M1.5b/attribution_a_attribuer — commande %s : « à attribuer »',
    async (_cas, dispatch) => {
      const base = baseSimulee({
        statutTms: 'attribuee_en_attente_acceptation',
        camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      });
      armer(
        [commande('CMD-1', dispatch ? 'TOUR-1' : undefined)],
        dispatch ? { 'TOUR-1': tournee('TOUR-1', dispatch) } : {},
      );

      await relever(base);

      expect(base.etat.collecte.statut_tms).toBe('a_attribuer');
    },
  );

  it('M1.5b/attribution_etat_inconnu — état de tournée non mesuré : rien n’est conclu, une seule trace', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'REFUSED'),
    });

    await relever(base);
    await relever(base);

    expect(base.etat.collecte.statut_tms).toBe(
      'attribuee_en_attente_acceptation',
    );
    expect(
      base.journal.filter((l) => l.startsWith('TOUR_DISPATCH_INCONNU:')),
    ).toEqual([
      "TOUR_DISPATCH_INCONNU: status.dispatch REFUSED : état d'attribution non mesuré, rien n'en est conclu",
    ]);
  });

  it.each([
    ['refusée ou annulée', 'programmee', 'rejetee_par_prestataire'],
    ['dont la mission a commencé', 'en_cours', 'acceptee'],
    ['annulée', 'annulee', 'annulee_par_traiteur'],
  ])(
    'M1.5b/attribution_garde — collecte %s : statut logistique inchangé',
    async (_cas, statut, statutTms) => {
      const base = baseSimulee({
        statut,
        statutTms,
        camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      });
      armer([commande('CMD-1', 'TOUR-1')], {
        'TOUR-1': tournee('TOUR-1', 'PROPOSED'),
      });

      await relever(base);

      expect(base.etat.collecte.statut_tms).toBe(statutTms);
    },
  );
});

describe('M1.5b / relève MTS-1 — collecte confiée hors MTS-1', () => {
  it.each([
    ['par mail', PRESTA_MANUEL, 'validee', 'acceptee', 'TOUR-1'],
    ['à A Toutes!', PRESTA_EVEREST, 'validee', 'acceptee', undefined],
  ])(
    'M1.5b/collecte_hors_mts1 — collecte confiée depuis %s, commande MTS-1 encore vivante : ni son prestataire ni son statut logistique ne sont réécrits',
    async (_cas, prestataire, statut, statutTms, tourId) => {
      const base = baseSimulee({
        statut,
        statutTms,
        prestataireCollecte: prestataire,
        camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      });
      armer([commande('CMD-1', tourId)], {
        'TOUR-1': tournee('TOUR-1', 'ACCEPTED', CODE_MTS1_BIS),
      });

      await relever(base);

      expect(base.etat.collecte.prestataire_logistique_id).toBe(prestataire);
      expect(base.etat.collecte.statut_tms).toBe(statutTms);
    },
  );
});

describe('M1.5b / relève MTS-1 — attribution relevée au changement d’état', () => {
  it('M1.5b/attribution_reacceptation_requise — une collecte remise « en attente d’acceptation » par une modification y reste tant que MTS-1 ne montre rien de nouveau, puis suit la nouvelle acceptation', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    const tours = { 'TOUR-1': tournee('TOUR-1', 'ACCEPTED') };
    armer([commande('CMD-1', 'TOUR-1')], tours);

    await relever(base);
    expect(base.etat.collecte.statut_tms).toBe('acceptee');

    // Le client change la date : réacceptation requise (§08).
    base.etat.collecte.statut_tms = 'attribuee_en_attente_acceptation';
    await relever(base);
    expect(base.etat.collecte.statut_tms).toBe(
      'attribuee_en_attente_acceptation',
    );

    // L'Admin repropose la tournée, le transporteur l'accepte à nouveau.
    tours['TOUR-1'] = tournee('TOUR-1', 'PROPOSED');
    await relever(base);
    tours['TOUR-1'] = tournee('TOUR-1', 'ACCEPTED');
    await relever(base);
    expect(base.etat.collecte.statut_tms).toBe('acceptee');
  });

  it('M1.5b/attribution_hors_garde_non_notee — collecte encore « non envoyée » : rien n’est écrit ni noté ; passée « à attribuer », l’acceptation est relevée au passage suivant', async () => {
    const base = baseSimulee({
      statutTms: 'non_envoye',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'ACCEPTED'),
    });

    await relever(base);
    expect(base.etat.collecte.statut_tms).toBe('non_envoye');

    base.etat.collecte.statut_tms = 'a_attribuer';
    await relever(base);
    expect(base.etat.collecte.statut_tms).toBe('acceptee');
  });

  it('M1.5b/attribution_commande_deplacee — la commande passe sur une autre tournée, proposée : la collecte revient « en attente d’acceptation »', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    const lot = [commande('CMD-1', 'TOUR-1')];
    armer(lot, {
      'TOUR-1': tournee('TOUR-1', 'ACCEPTED'),
      'TOUR-2': tournee('TOUR-2', 'PROPOSED'),
    });

    await relever(base);
    expect(base.etat.collecte.statut_tms).toBe('acceptee');

    lot[0] = commande('CMD-1', 'TOUR-2');
    await relever(base);
    expect(base.etat.collecte.statut_tms).toBe(
      'attribuee_en_attente_acceptation',
    );
  });
});

describe('M1.5b / relève MTS-1 — collecte à plusieurs camions', () => {
  it('M1.5b/attribution_multi_camions_un_seul_accepte — un camion accepté, l’autre proposé : « en attente d’acceptation »', async () => {
    const base = baseSimulee({
      statutTms: 'a_attribuer',
      camions: [
        { id: 't1', rang: 1, commande: 'CMD-1' },
        { id: 't2', rang: 2, commande: 'CMD-2' },
      ],
    });
    // Seul le camion accepté est relu à ce passage : l'autre est lu chez MTS-1
    // par l'identifiant de sa commande.
    armer(
      [commande('CMD-1', 'TOUR-1')],
      {
        'TOUR-1': tournee('TOUR-1', 'ACCEPTED'),
        'TOUR-2': tournee('TOUR-2', 'PROPOSED'),
      },
      [commande('CMD-2', 'TOUR-2')],
    );

    await relever(base);

    expect(base.etat.collecte.statut_tms).toBe(
      'attribuee_en_attente_acceptation',
    );
  });

  it('M1.5b/attribution_multi_camions_tous_acceptes — tous les camions acceptés, sur une ou deux tournées : « acceptée »', async () => {
    for (const tourDuSecond of ['TOUR-1', 'TOUR-2']) {
      const base = baseSimulee({
        statutTms: 'attribuee_en_attente_acceptation',
        camions: [
          { id: 't1', rang: 1, commande: 'CMD-1' },
          { id: 't2', rang: 2, commande: 'CMD-2' },
        ],
      });
      armer(
        [commande('CMD-1', 'TOUR-1')],
        {
          'TOUR-1': tournee('TOUR-1', 'ACCEPTED'),
          'TOUR-2': tournee('TOUR-2', 'ACCEPTED'),
        },
        [commande('CMD-2', tourDuSecond)],
      );

      await relever(base);

      expect(base.etat.collecte.statut_tms).toBe('acceptee');
    }
  });

  it('M1.5b/attribution_multi_camions_un_hors_tournee — un camion accepté, l’autre dans aucune tournée : « à attribuer »', async () => {
    const base = baseSimulee({
      statutTms: 'acceptee',
      camions: [
        { id: 't1', rang: 1, commande: 'CMD-1' },
        { id: 't2', rang: 2, commande: 'CMD-2' },
      ],
    });
    armer(
      [commande('CMD-1', 'TOUR-1')],
      { 'TOUR-1': tournee('TOUR-1', 'ACCEPTED') },
      [commande('CMD-2')],
    );

    await relever(base);

    expect(base.etat.collecte.statut_tms).toBe('a_attribuer');
  });

  it('M1.5b/attribution_multi_camions_mission_finie — un camion dont la mission est finie compte pour accepté, sans être relu', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [
        { id: 't1', rang: 1, commande: 'CMD-1' },
        { id: 't2', rang: 2, commande: 'CMD-2', statut: 'terminee' },
      ],
    });
    const h = armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'ACCEPTED'),
    });

    await relever(base);

    expect(base.etat.collecte.statut_tms).toBe('acceptee');
    expect(h.findOrdersByIds).not.toHaveBeenCalled();
  });
});

describe('M1.5b / relève MTS-1 — transporteur choisi dans la console', () => {
  it('M1.5b/transporteur_suivi — l’Admin a confié la tournée à un autre transporteur MTS-1 : la tournée du camion et la collecte le suivent', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'ACCEPTED', CODE_MTS1_BIS),
    });

    await relever(base);

    expect(base.etat.tournees[0]!.prestataire_logistique_id).toBe(
      PRESTA_MTS1_BIS,
    );
    expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1_BIS);
    expect(base.alertes).toEqual([]);
  });

  it('M1.5b/transporteur_suivi_rang_2 — camion du rang 2 : seule sa tournée suit, la collecte garde le transporteur du rang 1', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [
        { id: 't1', rang: 1, commande: 'CMD-1' },
        { id: 't2', rang: 2, commande: 'CMD-2' },
      ],
    });
    armer([commande('CMD-1', 'TOUR-1'), commande('CMD-2', 'TOUR-2')], {
      'TOUR-1': tournee('TOUR-1', 'PROPOSED', CODE_MTS1),
      'TOUR-2': tournee('TOUR-2', 'PROPOSED', CODE_MTS1_BIS),
    });

    await relever(base);

    expect(base.etat.tournees.map((t) => t.prestataire_logistique_id)).toEqual([
      PRESTA_MTS1,
      PRESTA_MTS1_BIS,
    ]);
    expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1);
  });

  it.each([
    ['inconnu du référentiel', 'CA_INCONNU', 'absent du référentiel Savr'],
    ['illisible', 'CA/../X', '(code illisible)'],
  ])(
    'M1.5b/transporteur_inconnu — code transporteur %s : rien n’est changé, alerte Admin',
    async (_cas, code, motif) => {
      const base = baseSimulee({
        statutTms: 'attribuee_en_attente_acceptation',
        camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      });
      armer([commande('CMD-1', 'TOUR-1')], {
        'TOUR-1': tournee('TOUR-1', 'PROPOSED', code),
      });

      await relever(base);

      expect(base.etat.tournees[0]!.prestataire_logistique_id).toBe(
        PRESTA_MTS1,
      );
      expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1);
      expect(base.alertes).toHaveLength(1);
      expect(base.alertes[0]).toMatchObject({
        p_code: 'transporteur_mts1_inconnu',
        p_entity_type: 'collectes',
        p_entity_id: 'col-001',
      });
      expect(String(base.alertes[0]!['p_message'])).toContain(motif);
    },
  );

  it('M1.5b/transporteur_code_partage — code porté par deux transporteurs MTS-1 : rien n’est changé, alerte Admin', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      referentiel: [
        {
          prestataire_logistique_id: PRESTA_MTS1,
          type_tms: 'mts1',
          code_transporteur_mts1: CODE_MTS1,
        },
        {
          prestataire_logistique_id: PRESTA_MTS1_BIS,
          type_tms: 'mts1',
          code_transporteur_mts1: CODE_MTS1_BIS,
        },
        {
          prestataire_logistique_id: 'presta-doublon-uuid',
          type_tms: 'mts1',
          code_transporteur_mts1: CODE_MTS1_BIS,
        },
      ],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'PROPOSED', CODE_MTS1_BIS),
    });

    await relever(base);

    expect(base.etat.tournees[0]!.prestataire_logistique_id).toBe(PRESTA_MTS1);
    expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1);
    expect(base.alertes).toHaveLength(1);
    expect(String(base.alertes[0]!['p_message'])).toContain(
      'que portent plusieurs transporteurs du référentiel Savr',
    );
  });

  it('M1.5b/transporteur_hors_mts1 — code porté par un transporteur qui n’est pas MTS-1 : il n’est pas retenu, alerte Admin', async () => {
    const base = baseSimulee({
      statutTms: 'attribuee_en_attente_acceptation',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      referentiel: [
        {
          prestataire_logistique_id: PRESTA_MTS1,
          type_tms: 'mts1',
          code_transporteur_mts1: CODE_MTS1,
        },
        {
          prestataire_logistique_id: 'presta-velo-uuid',
          type_tms: 'a_toutes',
          code_transporteur_mts1: CODE_MTS1_BIS,
        },
      ],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'PROPOSED', CODE_MTS1_BIS),
    });

    await relever(base);

    expect(base.etat.tournees[0]!.prestataire_logistique_id).toBe(PRESTA_MTS1);
    expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1);
    expect(base.alertes).toHaveLength(1);
    expect(String(base.alertes[0]!['p_message'])).toContain(
      'absent du référentiel Savr',
    );
  });

  it.each(['realisee', 'annulee'])(
    'M1.5b/transporteur_hors_execution — collecte %s : ni sa tournée ni la collecte ne suivent le transporteur de la console',
    async (statut) => {
      const base = baseSimulee({
        statut,
        statutTms: 'acceptee',
        camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
      });
      armer([commande('CMD-1', 'TOUR-1')], {
        'TOUR-1': tournee('TOUR-1', 'ACCEPTED', CODE_MTS1_BIS),
      });

      await relever(base);

      expect(base.etat.tournees[0]!.prestataire_logistique_id).toBe(
        PRESTA_MTS1,
      );
      expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1);
      expect(base.alertes).toEqual([]);
    },
  );

  it('M1.5b/transporteur_tournee_non_envoyee — tournée pas encore confiée à un transporteur : rien n’est changé, aucune alerte', async () => {
    const base = baseSimulee({
      statutTms: 'a_attribuer',
      camions: [{ id: 't1', rang: 1, commande: 'CMD-1' }],
    });
    armer([commande('CMD-1', 'TOUR-1')], {
      'TOUR-1': tournee('TOUR-1', 'TO_BE_DISPATCHED'),
    });

    await relever(base);

    expect(base.etat.collecte.prestataire_logistique_id).toBe(PRESTA_MTS1);
    expect(base.alertes).toEqual([]);
  });
});
