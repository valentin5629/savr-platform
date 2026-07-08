import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Collecte, Lieu, Transporteur } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import { _setMts1Handlers } from './mock.js';

// =============================================================================
// R22c / BL-P2-10 — buildUpdatePayload (E2 collecte.modifiee) doit repousser les
// contacts vers MTS-1, alignés sur buildOrderPayload (E1). Avant le fix, le PUT ne
// portait que place+orderDate → une édition de contact d'un événement dispatché
// n'atteignait jamais le prestataire.
// =============================================================================

const LIEU_FIXTURE: Lieu = {
  id: 'lieu-001',
  nom: 'Salle Pleyel',
  adresse_acces: '252 Rue du Faubourg Saint-Honoré',
  code_postal: '75008',
  ville: 'Paris',
  latitude: 48.8789,
  longitude: 2.3049,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

const COLLECTE_PRINCIPAL: Collecte = {
  id: 'col-r22c-001',
  type: 'zero_dechet',
  date_collecte: '2026-07-15',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  statut_tms: 'acceptee',
  controle_acces_requis: false,
  informations_supplementaires: null,
  notes_internes: null,
  contact_principal_nom: 'Alice Martin',
  contact_principal_telephone: '+33600000001',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  lieu: LIEU_FIXTURE,
};

const COLLECTE_AVEC_SECOURS: Collecte = {
  ...COLLECTE_PRINCIPAL,
  id: 'col-r22c-002',
  contact_secours_nom: 'Bruno Secours',
  contact_secours_telephone: '+33600000002',
};

const TRANSPORTEUR: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

// Mock supabase : findTournees('collecte_tournees') renvoie 1 tournée dispatchée
// (external_ref_commande présent) → updateCollecte procède au PUT.
function makeMockSupabaseDispatched() {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({
      data: [
        {
          rang: 1,
          tournees: [
            {
              id: 'tournee-r22c',
              external_ref_commande: 'MTS1-ORDER-R22C',
              tms_reference: 'MTS1-TOUR-R22C',
              statut: 'en_cours',
            },
          ],
        },
      ],
      error: null,
    }),
    // client.updateOrder logge dans integrations_logs après le PUT.
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(mockQuery),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('M1.4/r22c — AdapterMts1 buildUpdatePayload repousse les contacts (E2)', () => {
  afterEach(() => _setMts1Handlers(null));

  it('M1.4/r22c — updateCollecte PUT contient le contact principal', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    await new AdapterMts1(
      TRANSPORTEUR,
      makeMockSupabaseDispatched(),
    ).updateCollecte(COLLECTE_PRINCIPAL);

    expect(updateOrder).toHaveBeenCalledOnce();
    const payload = updateOrder.mock.calls[0]![1] as Record<string, unknown>;
    const contacts = payload['contacts'] as Array<{
      name: string;
      phone: string;
      role: string;
    }>;
    expect(contacts).toBeDefined();
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      name: 'Alice Martin',
      phone: '+33600000001',
      role: 'principal',
    });
  });

  it('M1.4/r22c — updateCollecte PUT inclut le contact de secours quand présent', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    await new AdapterMts1(
      TRANSPORTEUR,
      makeMockSupabaseDispatched(),
    ).updateCollecte(COLLECTE_AVEC_SECOURS);

    const payload = updateOrder.mock.calls[0]![1] as Record<string, unknown>;
    const contacts = payload['contacts'] as Array<{
      name: string;
      phone: string;
      role: string;
    }>;
    expect(contacts).toHaveLength(2);
    expect(contacts[1]).toMatchObject({
      name: 'Bruno Secours',
      phone: '+33600000002',
      role: 'secours',
    });
  });

  it('M1.4/r22c — updateCollecte PUT conserve place + orderDate (merge partiel)', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      updateOrder,
    });

    await new AdapterMts1(
      TRANSPORTEUR,
      makeMockSupabaseDispatched(),
    ).updateCollecte(COLLECTE_PRINCIPAL);

    const payload = updateOrder.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload['orderDate']).toBe('2026-07-15');
    expect(payload['place']).toEqual({
      address: {
        addressSingleLine: '252 Rue du Faubourg Saint-Honoré, 75008 Paris',
      },
    });
  });
});
