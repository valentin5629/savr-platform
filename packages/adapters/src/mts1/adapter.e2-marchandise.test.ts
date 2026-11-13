import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Collecte, Lieu, Transporteur } from '../index.js';
import { LogistiquePermanentError } from '../index.js';
import { AdapterMts1, annulerCommandesMts1 } from './adapter.js';
import {
  PRESTA_MTS1,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';
import { _setMts1Handlers } from './mock.js';

// =============================================================================
// E2 `collecte.modifiee` — la marchandise repart avec la modification.
//
// Mesuré le 2026-11-13 sur le compte de démonstration (collecte « Annual
// Party » de dev) : deux « Renvoyer à MTS-1 » = deux PUT sans `stuffs` ; la
// commande en est ressortie avec `stuffs = []` (ni « Don alimentaire », ni
// adresse de l'association), au statut `DRAFT`, et la validation de sa tournée
// `CANCELED`. Les commandes jamais modifiées gardaient leur stuff. Toute
// modification d'une collecte MTS-1 vidait donc sa commande.
//
// Correctif (décision Val 2026-11-13) : la marchandise, point B compris, part
// dans le PUT tant que la mission n'a pas commencé (collecte programmée ou
// validée) ; jamais après, ses quantités à 0 écraseraient les poids saisis.
// =============================================================================

const LIEU: Lieu = {
  id: 'lieu-001',
  nom: 'Trianon',
  adresse_acces: '80 Boulevard de Rochechouart',
  code_postal: '75018',
  ville: 'Paris',
  latitude: null,
  longitude: null,
  acces_details: null,
  type_vehicule_max: 'fourgon',
  contraintes_horaires: null,
};

const COLLECTE_AG: Collecte = {
  id: 'col-e2-marchandise',
  type: 'anti_gaspi',
  statut: 'programmee',
  date_collecte: '2026-11-13',
  heure_collecte: '20:45:00',
  nb_camions_demande: 1,
  statut_tms: 'a_attribuer',
  controle_acces_requis: false,
  informations_supplementaires: null,
  contact_principal_nom: 'Alice Martin',
  contact_principal_telephone: '+33600000001',
  lieu: LIEU,
  association_adresse: '14 Rue Royale, Paris',
  association_contact_nom: 'Nadia Benali',
  association_contact_telephone: '+33699990001',
  association_id_point_collecte_mts1: null,
};

const TRANSPORTEUR: Transporteur = {
  id: 'transp-marathon',
  type_tms: 'mts1',
  code_transporteur_mts1: 'MARATHON',
  prestataire_logistique_id: PRESTA_MTS1,
};

// Une tournée rang 1 déjà commandée chez MTS-1 : updateCollecte fait le PUT.
function supabaseCommandee() {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({
      data: [
        {
          rang: 1,
          tournees: {
            id: 'tournee-1',
            reference_interne: 'TMS-col-e2-marchandise-1',
            external_ref_commande: 'MTS1-ORDER-1',
            tms_reference: 'MTS1-TOUR-1',
            statut: 'planifiee',
            prestataire_logistique_id: PRESTA_MTS1,
          },
        },
      ],
      error: null,
    }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn((table: string) =>
      table === 'transporteurs' ? builderTransporteurs() : q,
    ),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

async function corpsDuPut(
  collecte: Collecte,
): Promise<Record<string, unknown>> {
  const updateOrder = vi.fn().mockResolvedValue(undefined);
  _setMts1Handlers({
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder: vi.fn(),
    updateOrder,
  });
  await new AdapterMts1(TRANSPORTEUR, supabaseCommandee()).updateCollecte(
    collecte,
  );
  expect(updateOrder).toHaveBeenCalledOnce();
  return updateOrder.mock.calls[0]![1] as Record<string, unknown>;
}

describe('E2 — la modification d’une commande MTS-1 renvoie sa marchandise avant la mission', () => {
  afterEach(() => _setMts1Handlers(null));

  it('AG programmée : le PUT porte le « Don alimentaire » et l’adresse de l’association (point B)', async () => {
    const corps = await corpsDuPut(COLLECTE_AG);

    expect(corps['stuffs']).toEqual([
      {
        name: 'Don alimentaire',
        task: 'PICKUP',
        quantity: 0,
        relatedAddress: {
          address: { addressSingleLine: '14 Rue Royale, Paris' },
        },
        relatedContact: {
          firstname: 'Nadia',
          lastname: 'Benali',
          phone: '+33699990001',
        },
      },
    ]);
  });

  it('AG validée, association en lieu favori MTS-1 : le point B part par son placeId', async () => {
    const corps = await corpsDuPut({
      ...COLLECTE_AG,
      statut: 'validee',
      association_id_point_collecte_mts1: 'PLACE-ASSO-1',
    });

    expect(corps['stuffs']).toEqual([
      {
        name: 'Don alimentaire',
        task: 'PICKUP',
        quantity: 0,
        relatedAddress: { placeId: 'PLACE-ASSO-1' },
      },
    ]);
  });

  it('ZD validée : les cinq flux et le volume du camion repartent', async () => {
    const corps = await corpsDuPut({
      ...COLLECTE_AG,
      type: 'zero_dechet',
      statut: 'validee',
    });

    const stuffs = corps['stuffs'] as Array<{ name: string }>;
    expect(stuffs).toHaveLength(6);
    expect(stuffs.map((s) => s.name)).toContain('<volume_du_camion>');
  });

  it.each(['en_cours', 'realisee'])(
    'mission commencée (%s) : aucune marchandise dans le PUT, les poids saisis restent',
    async (statut) => {
      const corps = await corpsDuPut({ ...COLLECTE_AG, statut });

      expect(corps).not.toHaveProperty('stuffs');
      // Le reste de la modification part toujours.
      expect(corps).toHaveProperty('place');
      expect(corps).toHaveProperty('comment');
    },
  );

  it('statut inconnu de l’appelant : aucune marchandise (prudence)', async () => {
    const sansStatut: Collecte = { ...COLLECTE_AG, statut: undefined };
    const corps = await corpsDuPut(sansStatut);

    expect(corps).not.toHaveProperty('stuffs');
  });
});

describe('Changement d’association — annulation des anciennes commandes MTS-1', () => {
  afterEach(() => _setMts1Handlers(null));

  const annuler = (ids: string[]) =>
    annulerCommandesMts1(supabaseCommandee(), ids);

  it('supprime chaque ancienne commande', async () => {
    const deleteOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    await annuler(['MTS1-ORDER-1', 'MTS1-ORDER-2']);

    expect(deleteOrder.mock.calls.map((c) => c[0])).toEqual([
      'MTS1-ORDER-1',
      'MTS1-ORDER-2',
    ]);
  });

  it('une commande déjà supprimée (404) ne bloque pas la reprise', async () => {
    const deleteOrder = vi
      .fn()
      .mockRejectedValueOnce(new LogistiquePermanentError('MTS-1 404 : absent'))
      .mockResolvedValueOnce(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    await expect(
      annuler(['MTS1-ORDER-1', 'MTS1-ORDER-2']),
    ).resolves.toBeUndefined();
    expect(deleteOrder).toHaveBeenCalledTimes(2);
  });

  it('un refus de MTS-1 autre que 404 remonte : l’ordre n’est pas clos à tort', async () => {
    const deleteOrder = vi
      .fn()
      .mockRejectedValue(
        new LogistiquePermanentError('MTS-1 400 : tournée envoyée'),
      );
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      deleteOrder,
    });

    await expect(annuler(['MTS1-ORDER-1'])).rejects.toThrow('MTS-1 400');
  });
});
