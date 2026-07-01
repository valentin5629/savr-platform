import { afterEach, describe, expect, it, vi } from 'vitest';

import { LogistiquePermanentError } from '../index.js';
import type { Collecte, Lieu, Transporteur } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import { _setMts1Handlers } from './mock.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const LIEU: Lieu = {
  id: 'lieu-001',
  nom: 'Salle Pleyel',
  adresse_acces: '252 Rue du Faubourg Saint-Honoré',
  code_postal: '75008',
  ville: 'Paris',
  latitude: 48.87,
  longitude: 2.3,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

function collecte(nb: number): Collecte {
  return {
    id: 'col-multi-001',
    type: 'zero_dechet',
    date_collecte: '2026-07-15',
    heure_collecte: '22:00:00',
    nb_camions_demande: nb,
    statut_tms: 'acceptee',
    controle_acces_requis: false,
    informations_supplementaires: null,
    notes_internes: null,
    contact_principal_nom: 'Alice',
    contact_principal_telephone: '+33600000001',
    contact_secours_nom: null,
    contact_secours_telephone: null,
    lieu: LIEU,
  };
}

const TRANSPORTEUR: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

type TRow = {
  id: string;
  rang: number;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
};

// Mock supabase : le builder est thenable → `await from().select().eq()` résout
// vers les tournées (findTournees) ; les .delete().eq()… résolvent aussi (résultat
// ignoré par deleteTourneeRang, qui ne lit que l'absence d'exception).
function makeSupabase(
  tournees: TRow[],
): import('@supabase/supabase-js').SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    delete: vi.fn(chain),
    update: vi.fn(chain),
    insert: vi.fn(chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: tournees.map((t) => ({ rang: t.rang, tournees: [t] })),
        error: null,
      }),
  });
  return {
    from: vi.fn(() => builder),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

function row(rang: number): TRow {
  return {
    id: `T${rang}`,
    rang,
    external_ref_commande: `MTS1-ORDER-00${rang}`,
    tms_reference: `MTS1-TOUR-00${rang}`,
    statut: 'en_cours',
  };
}

describe('M1.5a / multi-camions updateCollecte (RM-03/04)', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.5a / RM-03 augmentation N→N+k — crée les rangs manquants via dispatchCollecte', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    // 2 rangs existants, N passé à 4.
    const supabase = makeSupabase([row(1), row(2)]);
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);
    const dispatchSpy = vi
      .spyOn(adapter, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');

    const tag = await adapter.updateCollecte(collecte(4));

    expect(tag).toBe('adapter_mts1');
    // PUT sur les 2 rangs conservés.
    expect(updateOrder).toHaveBeenCalledTimes(2);
    // Rangs manquants 3 et 4 créés (idempotent, clé reference-{rang}).
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'col-multi-001' }),
      3,
      expect.anything(),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'col-multi-001' }),
      4,
      expect.anything(),
    );
  });

  it('M1.5a / RM-04 réduction N→N−k — supprime sélectivement les rangs > N', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
      deleteOrder,
    });

    // 3 rangs existants, N réduit à 2 → rang 3 supprimé.
    const supabase = makeSupabase([row(1), row(2), row(3)]);
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);
    const dispatchSpy = vi
      .spyOn(adapter, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');

    const tag = await adapter.updateCollecte(collecte(2));

    expect(tag).toBe('adapter_mts1');
    // Commande MTS-1 du rang 3 supprimée (le handler mock ne reçoit que l'orderId).
    expect(deleteOrder).toHaveBeenCalledTimes(1);
    expect(deleteOrder).toHaveBeenCalledWith('MTS1-ORDER-003');
    // PUT sur les 2 rangs conservés, aucune création.
    expect(updateOrder).toHaveBeenCalledTimes(2);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('M1.5a / RM-04 — 404 sur deleteOrder = idempotent (rang déjà supprimé côté MTS-1)', async () => {
    const deleteOrder = vi
      .fn()
      .mockRejectedValue(new LogistiquePermanentError('MTS-1 404 : not found'));
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder: vi.fn().mockResolvedValue(undefined),
      deleteOrder,
    });

    const supabase = makeSupabase([row(1), row(2)]);
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);
    vi.spyOn(adapter, 'dispatchCollecte').mockResolvedValue('adapter_mts1');

    // N=1 → rang 2 retiré ; le 404 ne doit PAS faire échouer la réduction.
    await expect(adapter.updateCollecte(collecte(1))).resolves.toBe(
      'adapter_mts1',
    );
    expect(deleteOrder).toHaveBeenCalledOnce();
  });

  it('M1.5a / RM-03/04 — N inchangé : PUT seul, ni création ni suppression', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
      deleteOrder,
    });

    const supabase = makeSupabase([row(1), row(2)]);
    const adapter = new AdapterMts1(TRANSPORTEUR, supabase);
    const dispatchSpy = vi
      .spyOn(adapter, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');

    await adapter.updateCollecte(collecte(2));

    expect(updateOrder).toHaveBeenCalledTimes(2);
    expect(deleteOrder).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
