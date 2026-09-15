// Chaîne complète : un dispatch RÉEL pose `plateforme.collectes.tms_reference`.
//
// Contexte (2026-09-15) : cette colonne n'était écrite par AUCUN code de production
// — l'adapter n'écrivait que `tournees.tms_reference`, et les seules écritures sur
// `collectes` étaient des fixtures pgTAP. Sur savr-dev : 619 collectes réellement
// dispatchées, ZÉRO avec la colonne renseignée. Elle gatait pourtant l'émission de
// E2 `collecte.modifiee`, qui n'est donc jamais partie en production.
//
// Depuis, les deux rôles sont séparés :
//   • prédicat d'émission → `fn_collecte_commandee_chez_provider` (pgTAP
//     supabase/tests/e2_gate_commande_provider.test.sql) ;
//   • valeur d'affichage / rapprochement → cette colonne, posée ICI au dispatch
//     (§04 Data Model l.1509, §06.06 bouton « Renvoyer au TMS », §11 carte
//     « Collectes non transmises au TMS »).
//
// Ce fichier verrouille le second volet, sur les DEUX providers. Le mock trace la
// table de chaque `.update()` : une assertion qui ne regarderait que le payload
// passerait aussi bien sur un UPDATE de `tournees` — c'est exactement la confusion
// qui a produit la régression.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { builderTransporteurs } from './mock-referentiel-transporteurs.js';

import type { Collecte, Lieu, Transporteur } from './index.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { _setMts1Handlers } from './mts1/mock.js';
import { AdapterEverest } from './everest/adapter.js';
import { _setEverestHandlers, setupEverestMock } from './everest/mock.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LIEU: Lieu = {
  id: 'lieu-ref-001',
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

const COLLECTE: Collecte = {
  id: 'col-ref-001',
  type: 'zero_dechet',
  date_collecte: '2026-07-15',
  heure_collecte: '22:00:00',
  nb_camions_demande: 2,
  statut_tms: 'non_envoye',
  controle_acces_requis: false,
  informations_supplementaires: null,
  notes_internes: null,
  contact_principal_nom: 'Alice Martin',
  contact_principal_telephone: '+33600000001',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  lieu: LIEU,
};

const COLLECTE_AG: Collecte = {
  ...COLLECTE,
  id: 'col-ref-ag-001',
  type: 'anti_gaspi',
  nb_camions_demande: 1,
};

const TRANSPORTEUR_CAMION: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

const TRANSPORTEUR_VELO: Transporteur = {
  id: 'presta-velo-001',
  type_tms: 'a_toutes',
  code_transporteur_mts1: null,
  prestataire_logistique_id: 'presta-uuid-002',
};

// ─── Mock Supabase traçant (table, payload) de chaque update ──────────────────

interface Updates {
  table: string;
  payload: Record<string, unknown>;
}

function makeTracingSupabase(opts: { brancheAttribution?: string } = {}) {
  const updates: Updates[] = [];

  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    q['select'] = vi.fn(() => q);
    q['eq'] = vi.fn(() => q);
    q['contains'] = vi.fn(() => q);
    q['limit'] = vi.fn(() => q);
    q['upsert'] = vi.fn(() => q);
    q['update'] = vi.fn((payload: Record<string, unknown>) => {
      updates.push({ table, payload });
      return q;
    });
    q['insert'] = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'tournee-new-001',
          external_ref_commande: null,
          statut: 'planifiee',
        },
        error: null,
      }),
    }));
    q['single'] = vi.fn().mockResolvedValue({
      data: {
        id: 'tournee-new-001',
        external_ref_commande: null,
        tms_reference: null,
        statut: 'planifiee',
      },
      error: null,
    });
    q['maybeSingle'] = vi.fn().mockImplementation(async () => {
      if (table === 'attributions_antgaspi') {
        return {
          data: {
            branche_attribution: opts.brancheAttribution ?? 'ag_velo_programme',
          },
          error: null,
        };
      }
      // Aucune tournée préexistante : on force le chemin de dispatch complet.
      return { data: null, error: null };
    });
    (q as { then?: unknown })['then'] = (
      onfulfilled: (v: { data: unknown; error: null }) => unknown,
    ) => Promise.resolve({ data: [], error: null }).then(onfulfilled);
    return q;
  };

  const tables: Record<string, ReturnType<typeof makeTableQuery>> = {};
  const supabase = {
    // Le référentiel transporteurs est servi à part : les adapters y résolvent le
    // provider des tournées (cf. provider-tournees.ts) avant toute lecture.
    from: vi.fn((table: string) => {
      if (table === 'transporteurs') return builderTransporteurs();
      if (!tables[table]) tables[table] = makeTableQuery(table);
      return tables[table]!;
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    supabase:
      supabase as unknown as import('@supabase/supabase-js').SupabaseClient,
    updates,
  };
}

function refsPoseesSurCollectes(updates: Updates[]): unknown[] {
  return updates
    .filter((u) => u.table === 'collectes' && 'tms_reference' in u.payload)
    .map((u) => u.payload['tms_reference']);
}

// ─── Provider camion ─────────────────────────────────────────────────────────

describe('dispatch → collectes.tms_reference (provider camion)', () => {
  afterEach(() => {
    _setMts1Handlers(null);
    vi.unstubAllEnvs();
  });

  function handlers(suffixe: string) {
    const h = {
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn().mockResolvedValue({
        ok: true,
        id: `ORDER-${suffixe}`,
        externalReference: '',
        status: 'PLANNED',
        createdAt: '',
      }),
      createTour: vi.fn().mockResolvedValue({
        tourId: `TOUR-${suffixe}`,
        externalReference: '',
        status: 'DRAFT',
        createdAt: '',
        customerOrderId: `ORDER-${suffixe}`,
      }),
      addCustomerOrder: vi.fn().mockResolvedValue(undefined),
      dispatchTour: vi.fn().mockResolvedValue(undefined),
      validateTour: vi.fn().mockResolvedValue(undefined),
    };
    _setMts1Handlers(h);
    return h;
  }

  it('rang 1 — le dispatch écrit le tourId dans collectes.tms_reference (pas seulement dans tournees)', async () => {
    handlers('R1');
    const { supabase, updates } = makeTracingSupabase();
    await new AdapterMts1(TRANSPORTEUR_CAMION, supabase).dispatchCollecte(
      COLLECTE,
      1,
    );

    // Le cœur du correctif : la colonne de `collectes` est réellement écrite.
    expect(refsPoseesSurCollectes(updates)).toEqual(['TOUR-R1']);
    // …et la référence de la TOURNÉE reste écrite elle aussi (non-régression :
    // c'est elle que lit la reprise de dispatch, cf. garde d'idempotence).
    expect(
      updates.filter(
        (u) =>
          u.table === 'tournees' && u.payload['tms_reference'] === 'TOUR-R1',
      ),
    ).toHaveLength(1);
  });

  it('rang 2 — aucune écriture sur collectes.tms_reference (un seul identifiant de rapprochement)', async () => {
    handlers('R2');
    const { supabase, updates } = makeTracingSupabase();
    await new AdapterMts1(TRANSPORTEUR_CAMION, supabase).dispatchCollecte(
      COLLECTE,
      2,
    );

    expect(refsPoseesSurCollectes(updates)).toEqual([]);
    // Le rang 2 a bien été dispatché par ailleurs (sinon l'assertion ci-dessus
    // serait vide pour une mauvaise raison — un dispatch qui n'a rien fait).
    expect(
      updates.filter(
        (u) =>
          u.table === 'tournees' && u.payload['tms_reference'] === 'TOUR-R2',
      ),
    ).toHaveLength(1);
  });
});

// ─── Provider vélo-cargo ─────────────────────────────────────────────────────

describe('dispatch → collectes.tms_reference (provider vélo-cargo)', () => {
  afterEach(() => _setEverestHandlers(null));

  it('rang 1 — le dispatch écrit le missionId dans collectes.tms_reference', async () => {
    // Ce provider n'a pas de notion de tour : la référence de rapprochement est le
    // missionId, celui-là même qui atterrit dans tournees.external_ref_commande.
    const state = setupEverestMock();

    const { supabase, updates } = makeTracingSupabase();
    await new AdapterEverest(TRANSPORTEUR_VELO, supabase).dispatchCollecte(
      COLLECTE_AG,
      1,
    );

    const missionId = [...state.missions.values()][0]!.mission_id;
    expect(refsPoseesSurCollectes(updates)).toEqual([missionId]);
    expect(
      updates.filter(
        (u) =>
          u.table === 'tournees' &&
          u.payload['external_ref_commande'] === missionId,
      ),
    ).toHaveLength(1);
  });
});
