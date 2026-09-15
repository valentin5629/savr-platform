// Chaîne C10 (R5 / BL-P0-08) : outbox → worker → adapter.
// Prouve que le worker route une collecte AG dispatchée vers le BON adapter
// selon transporteurs.type_tms (résolu via le pont collecte.prestataire_logistique_id
// → transporteurs.prestataire_logistique_id). Asservi sur l'adapter réellement
// invoqué — pas un mock qui avale tout : si le routage retombe sur adapter_mts1
// en dur, le test pour a_toutes ROUGIT.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOutboxWorker } from './outbox-worker.js';
import { AdapterEverest } from './everest/adapter.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { ProviderManual } from './manual/provider.js';

// ─── Mock Supabase pour le worker ─────────────────────────────────────────────

interface WorkerMockOpts {
  typeTms: 'mts1' | 'a_toutes' | 'autre' | 'par_mail' | 'par_telephone';
  prestataireLogistiqueId: string | null;
  eventType?: 'collecte.creee' | 'collecte.modifiee' | 'collecte.annulee';
  lieuOverrides?: Record<string, unknown> | null;
  /** Valeurs du lieu OFFICIEL (référentiel), avant application des overrides. */
  lieuOfficiel?: Record<string, unknown>;
  /** `collectes.informations_supplementaires` — saisie du traiteur. */
  infosSuppl?: string | null;
}

const COLLECTE_ID = 'col-ag-dispatch-001';
const PRESTA_ID = 'presta-uuid-ag-001';

function makeWorkerSupabase(opts: WorkerMockOpts) {
  const claimedEvent = {
    id: 'evt-001',
    aggregate_type: 'collecte',
    aggregate_id: COLLECTE_ID,
    event_type: opts.eventType ?? 'collecte.creee',
    payload: { collecte_id: COLLECTE_ID, origine: 'attribution_ag' },
    consumer:
      opts.typeTms === 'a_toutes'
        ? 'adapter_everest'
        : opts.typeTms === 'mts1'
          ? 'adapter_mts1'
          : 'provider_manual',
    attempts: 1,
    requires_reconciliation: false,
  };

  // Contacts + lieu portés par l'événement parent (fetchCollecte les lit via la
  // jointure evenements!inner — fix M1.5a 2026-06-26 ; §06.04 l.375 / §08 l.411).
  const collecteRow = {
    id: COLLECTE_ID,
    type: 'anti_gaspi',
    date_collecte: '2026-07-20',
    heure_collecte: '22:00:00',
    nb_camions_demande: 1,
    statut_tms: 'non_envoye',
    controle_acces_requis: false,
    informations_supplementaires: opts.infosSuppl ?? null,
    notes_internes: null,
    prestataire_logistique_id: opts.prestataireLogistiqueId,
    lieu_overrides: opts.lieuOverrides ?? null,
    evenement: [
      {
        contact_principal_nom: 'Alice',
        contact_principal_telephone: '+33600000001',
        contact_secours_nom: null,
        contact_secours_telephone: null,
        lieux: [
          {
            id: 'lieu-001',
            nom: 'Lieu',
            adresse_acces: '1 rue Test',
            code_postal: '75001',
            ville: 'Paris',
            latitude: null,
            longitude: null,
            acces_details: null,
            type_vehicule_max: 'velo_cargo',
            contraintes_horaires: null,
            stationnement: null,
            acces_office: null,
            flux_autorises: null,
            ...(opts.lieuOfficiel ?? {}),
          },
        ],
      },
    ],
  };

  const transporteurRow = {
    id: 'transp-001',
    type_tms: opts.typeTms,
    code_transporteur_mts1: opts.typeTms === 'mts1' ? 'STRIKE-MTS1' : null,
    prestataire_logistique_id: opts.prestataireLogistiqueId,
  };

  // Trace des `select(...)` par table : seul moyen de verrouiller que les
  // colonnes lues par la composition sont bien DEMANDÉES à PostgREST (un mock ne
  // filtre pas sur le select — une colonne oubliée passerait `undefined` en
  // silence, exactement l'étage 1 du bug M1.5).
  const selects: Record<string, string[]> = {};

  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    q['select'] = vi.fn((fields?: string) => {
      if (!selects[table]) selects[table] = [];
      selects[table]!.push(fields ?? '');
      return q;
    });
    q['eq'] = vi.fn(() => q);
    q['single'] = vi.fn(async () => {
      if (table === 'collectes') return { data: collecteRow, error: null };
      if (table === 'transporteurs')
        return { data: transporteurRow, error: null };
      return { data: null, error: null };
    });
    q['maybeSingle'] = vi.fn(async () => ({ data: null, error: null }));
    q['update'] = vi.fn(() => q);
    q['insert'] = vi.fn(() => q);
    return q;
  };

  const rpc = vi.fn(async (name: string) => {
    if (name === 'fn_reap_outbox_claims') return { data: 0, error: null };
    if (name === 'fn_claim_outbox_batch')
      return { data: [claimedEvent], error: null };
    if (name === 'fn_result_outbox') return { data: null, error: null };
    return { data: null, error: null };
  });

  const supabase = {
    rpc,
    from: vi.fn((table: string) => makeTableQuery(table)),
    _selects: selects,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _selects: Record<string, string[]>;
  };
}

// ─── Tests routing par type_tms ───────────────────────────────────────────────

describe('M2.3 / worker outbox — routing dispatch AG par type_tms (C10)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('type_tms=a_toutes → AdapterEverest.dispatchCollecte (pas MTS-1)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
    });
    const result = await runOutboxWorker(supabase);

    expect(everestSpy).toHaveBeenCalledTimes(1);
    expect(mts1Spy).not.toHaveBeenCalled();
    // L'adapter reçoit bien la collecte AG dispatchée (rang 1).
    expect(everestSpy.mock.calls[0]![0]).toMatchObject({
      id: COLLECTE_ID,
      type: 'anti_gaspi',
    });
    expect(everestSpy.mock.calls[0]![1]).toBe(1);
    expect(result.done).toBe(1);
  });

  it('type_tms=mts1 → AdapterMts1.dispatchCollecte (pas Everest)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');

    const supabase = makeWorkerSupabase({
      typeTms: 'mts1',
      prestataireLogistiqueId: PRESTA_ID,
    });
    await runOutboxWorker(supabase);

    expect(mts1Spy).toHaveBeenCalledTimes(1);
    expect(everestSpy).not.toHaveBeenCalled();
  });

  it('type_tms=autre → ProviderManual.dispatchCollecte (no-op, ni MTS-1 ni Everest)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');
    const manualSpy = vi.spyOn(ProviderManual.prototype, 'dispatchCollecte');

    const supabase = makeWorkerSupabase({
      typeTms: 'autre',
      prestataireLogistiqueId: PRESTA_ID,
    });
    await runOutboxWorker(supabase);

    expect(manualSpy).toHaveBeenCalledTimes(1);
    expect(everestSpy).not.toHaveBeenCalled();
    expect(mts1Spy).not.toHaveBeenCalled();
  });

  // R17b (Val 2026-07-02) — 'par_mail'/'par_telephone' = hors TMS, validation
  // manuelle Admin : routés comme 'autre' vers ProviderManual, JAMAIS MTS-1/Everest.
  it.each(['par_mail', 'par_telephone'] as const)(
    'type_tms=%s → ProviderManual.dispatchCollecte (ni MTS-1 ni Everest)',
    async (typeTms) => {
      const everestSpy = vi
        .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
        .mockResolvedValue('adapter_everest');
      const mts1Spy = vi
        .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
        .mockResolvedValue('adapter_mts1');
      const manualSpy = vi.spyOn(ProviderManual.prototype, 'dispatchCollecte');

      const supabase = makeWorkerSupabase({
        typeTms,
        prestataireLogistiqueId: PRESTA_ID,
      });
      await runOutboxWorker(supabase);

      expect(manualSpy).toHaveBeenCalledTimes(1);
      expect(everestSpy).not.toHaveBeenCalled();
      expect(mts1Spy).not.toHaveBeenCalled();
    },
  );

  it('prestataire_logistique_id NULL → no-op (aucun adapter invoqué)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_mts1');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: null,
    });
    const result = await runOutboxWorker(supabase);

    expect(everestSpy).not.toHaveBeenCalled();
    expect(mts1Spy).not.toHaveBeenCalled();
    // Event consommé (no-op succès) — pas d'échec.
    expect(result.done).toBe(1);
    expect(result.failed).toBe(0);
  });

  // E2/E3 : les branches collecte.modifiee / collecte.annulee d'une collecte AG
  // (type_tms=a_toutes) doivent aussi router vers AdapterEverest, jamais MTS-1.
  it('E2 collecte.modifiee (a_toutes) → AdapterEverest.updateCollecte (pas MTS-1)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'updateCollecte')
      .mockResolvedValue('noop_no_remote');
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'updateCollecte')
      .mockResolvedValue('adapter_mts1');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      eventType: 'collecte.modifiee',
    });
    await runOutboxWorker(supabase);

    expect(everestSpy).toHaveBeenCalledTimes(1);
    expect(mts1Spy).not.toHaveBeenCalled();
  });

  it('E3 collecte.annulee (a_toutes) → AdapterEverest.cancelCollecte (pas MTS-1)', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'cancelCollecte')
      .mockResolvedValue('adapter_everest');
    const mts1Spy = vi
      .spyOn(AdapterMts1.prototype, 'cancelCollecte')
      .mockResolvedValue('adapter_mts1');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      eventType: 'collecte.annulee',
    });
    await runOutboxWorker(supabase);

    expect(everestSpy).toHaveBeenCalledTimes(1);
    expect(mts1Spy).not.toHaveBeenCalled();
  });

  // Les 3 gardes ci-dessous verrouillent ce qui NE DOIT PAS être surchargé. Ce
  // test verrouille l'autre sens : chaque champ de l'allowlist DOIT effectivement
  // être fusionné. Sans lui, une entrée retirée par mégarde à la prochaine
  // refacto redevient une surcharge saisie, stockée, auditée — et jamais
  // transmise, soit très exactement le bug que ce commit répare.
  it.each([
    ['adresse_acces', 'Entrée logistique corrigée'],
    ['code_postal', '75016'],
    ['ville', 'Boulogne-Billancourt'],
    ['acces_details', 'Sonner interphone Cuisine'],
    ['contraintes_horaires', 'Livraison après 22h uniquement'],
    ['type_vehicule_max', '20m3'],
    // Ajoutés 2026-09-15 (arbitrage Val, agrégation dans le champ libre) : ces
    // 3 champs étaient éditables au formulaire mais absents de l'interface
    // `Lieu`, donc hors de portée de l'allowlist — l'intersection
    // `LieuEdits` ∩ `Lieu` est désormais la parité, 9 champs.
    ['stationnement', 'tres_difficile'],
    ['acces_office', 'difficile'],
    ['flux_autorises', ['biodéchets', 'carton']],
  ])('le champ surchargeable %s est bien transmis', async (champ, valeur) => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      lieuOverrides: { [champ as string]: valeur },
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as unknown as {
      lieu: Record<string, unknown>;
    };
    expect(collecte.lieu[champ as string]).toEqual(valeur);
  });

  // Défense en profondeur : une lecture nue `overrides[key]` traverse la chaîne
  // de prototypes. Si `Object.prototype` est pollué ailleurs dans le process, une
  // clé que l'override ne porte PAS serait quand même transmise au transporteur.
  it("une clé héritée du prototype n'est pas lue comme un override", async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto['ville'] = 'VilleInjectee';
    try {
      const supabase = makeWorkerSupabase({
        typeTms: 'a_toutes',
        prestataireLogistiqueId: PRESTA_ID,
        // L'override ne porte PAS `ville` en propre.
        lieuOverrides: { adresse_acces: 'Entrée logistique' },
      });
      await runOutboxWorker(supabase);

      const collecte = everestSpy.mock.calls[0]![0] as unknown as {
        lieu: Record<string, unknown>;
      };
      expect(collecte.lieu['ville']).toBe('Paris');
      expect(collecte.lieu['adresse_acces']).toBe('Entrée logistique');
    } finally {
      delete proto['ville'];
    }
  });

  // `lieu_overrides` est un jsonb libre : aucun schéma, aucun CHECK, aucune
  // validation de clés sur les routes qui l'écrivent. La borne est donc
  // l'allowlist, et elle doit tenir face aux clés de prototype — un test
  // `key in lieu` les laisserait toutes passer (`'constructor' in {}` = true).
  it('une clé hors allowlist est ignorée, clés de prototype comprises', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      lieuOverrides: JSON.parse(
        JSON.stringify({
          id: 'lieu-d-une-autre-org',
          siren: '123456789',
          constructor: 'pollué',
          __proto__: { pollue: true },
          adresse_acces: 'Entrée logistique',
        }),
      ) as Record<string, unknown>,
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as unknown as {
      lieu: Record<string, unknown>;
    };
    // L'identité du lieu n'est pas surchargeable.
    expect(collecte.lieu['id']).not.toBe('lieu-d-une-autre-org');
    // Une clé inconnue du lieu n'entre pas dans l'objet transmis.
    expect(collecte.lieu['siren']).toBeUndefined();
    // Les clés de prototype ne deviennent pas des propriétés propres…
    expect(
      Object.prototype.hasOwnProperty.call(collecte.lieu, 'constructor'),
    ).toBe(false);
    // …et le prototype de l'objet transmis est intact.
    expect(Object.getPrototypeOf(collecte.lieu)).toBe(Object.prototype);
    // Aucune contamination globale.
    expect(({} as Record<string, unknown>)['pollue']).toBeUndefined();
    // …et la surcharge légitime passe toujours.
    expect(collecte.lieu['adresse_acces']).toBe('Entrée logistique');
  });

  // §06.01 — « Le nom du lieu reste figé (identifiant lieu) ». Ce merge est le
  // seul endroit où un override pourrait atteindre le transporteur : la garde
  // doit tenir même si `lieu_overrides` contient un jour la clé `nom`.
  it('un override de `nom` est ignoré — le nom du lieu reste figé', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      lieuOverrides: {
        nom: 'Nom bidon injecté',
        adresse_acces: 'Entrée logistique',
      },
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as {
      lieu: { nom: string; adresse_acces: string };
    };
    expect(collecte.lieu.nom).not.toBe('Nom bidon injecté');
    // …et la surcharge légitime passe toujours.
    expect(collecte.lieu.adresse_acces).toBe('Entrée logistique');
  });

  // PROG-01/PROG-03 (§06.01) — l'adresse d'accès corrigée par collecte
  // (lieu_overrides) doit parvenir au transporteur. Sans le merge dans
  // fetchCollecte, le worker re-fetche le lieu officiel et le camion se présente
  // à la mauvaise adresse la nuit.
  it('lieu_overrides surcharge l’adresse transmise à l’adapter, sans écraser les clés absentes', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      lieuOverrides: {
        adresse_acces: 'Entrée logistique, 8 rue de la Faisanderie',
        acces_details: 'Sonner interphone Cuisine',
        // Une valeur nulle ne doit jamais écraser le lieu officiel.
        ville: null,
      },
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as {
      lieu: {
        adresse_acces: string;
        acces_details: string | null;
        ville: string;
      };
    };
    // Les clés surchargées remplacent le lieu officiel…
    expect(collecte.lieu.adresse_acces).toBe(
      'Entrée logistique, 8 rue de la Faisanderie',
    );
    expect(collecte.lieu.acces_details).toBe('Sonner interphone Cuisine');
    // …la valeur nulle est ignorée (ville officielle conservée)…
    expect(collecte.lieu.ville).toBe('Paris');
  });

  it('sans lieu_overrides, l’adresse officielle est transmise inchangée', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as {
      lieu: { adresse_acces: string };
    };
    expect(collecte.lieu.adresse_acces).toBe('1 rue Test');
  });
});

// ─── Agrégation des infos d'accès dans le canal libre (Val 2026-09-15) ────────
//
// Les 6 informations d'accès du lieu n'ont pas de champ natif MTS-1/Everest :
// elles sont agrégées dans `informations_supplementaires`, seul champ libre
// routé (`comment` MTS-1 / `notes` Everest). L'agrégation est faite UNE fois
// dans fetchCollecte — garde-fou 2 : même sémantique pour l'adapter V1 et le TMS
// V2, et le drift par adapter a déjà été vécu sur `dirty_tms` (#196). Ces tests
// verrouillent donc le caractère PARTAGÉ de la composition, provider par
// provider ; la présence sur le fil (`comment` / `notes`) est vérifiée dans
// mts1/adapter.m1-5a.test.ts et everest/adapter.m2-5.test.ts.

const LIEU_ACCES_COMPLET = {
  acces_details: 'Quai n°2, sonner interphone B',
  stationnement: 'difficile',
  contraintes_horaires: 'Livraison avant 9h uniquement',
  acces_office: 'tres_difficile',
  type_vehicule_max: 'camionnette',
  flux_autorises: ['biodéchets', 'carton'],
};

// Ce que le chauffeur doit lire pour chacun des 6 champs.
const ATTENDU_PAR_CHAMP: Array<[string, string]> = [
  ['acces_details', 'Accès : Quai n°2, sonner interphone B'],
  ['stationnement', 'Stationnement : difficile'],
  [
    'contraintes_horaires',
    'Contraintes horaires : Livraison avant 9h uniquement',
  ],
  ['acces_office', 'Accès office : très difficile'],
  ['type_vehicule_max', 'Véhicule max : camionnette'],
  ['flux_autorises', 'Flux acceptés : biodéchets, carton'],
];

describe('M1.5 / infos d’accès agrégées dans le canal libre — les 2 adapters', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['a_toutes', AdapterEverest] as const,
    ['mts1', AdapterMts1] as const,
  ])(
    'type_tms=%s — les 6 infos d’accès du lieu atteignent l’adapter',
    async (typeTms, Adapter) => {
      const spy = vi
        .spyOn(Adapter.prototype, 'dispatchCollecte')
        .mockResolvedValue('noop_no_remote');

      const supabase = makeWorkerSupabase({
        typeTms,
        prestataireLogistiqueId: PRESTA_ID,
        lieuOfficiel: LIEU_ACCES_COMPLET,
      });
      await runOutboxWorker(supabase);

      const collecte = spy.mock.calls[0]![0] as {
        informations_supplementaires: string | null;
      };
      for (const [champ, ligne] of ATTENDU_PAR_CHAMP) {
        expect(
          collecte.informations_supplementaires,
          `champ ${champ} absent du canal libre`,
        ).toContain(ligne);
      }
    },
  );

  // Le piège exact de #304 : re-fetcher le lieu OFFICIEL au lieu du lieu fusionné
  // retransmettrait la valeur du référentiel, pas la correction saisie.
  it('l’agrégat part du lieu FUSIONNÉ, jamais du lieu officiel', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      lieuOfficiel: { stationnement: 'facile' },
      lieuOverrides: { stationnement: 'tres_difficile' },
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as {
      informations_supplementaires: string | null;
    };
    expect(collecte.informations_supplementaires).toContain(
      'Stationnement : très difficile',
    );
    expect(collecte.informations_supplementaires).not.toContain(
      'Stationnement : facile',
    );
  });

  it('la saisie du traiteur est conservée — l’agrégat s’y ajoute', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      infosSuppl: 'Demander Karim à la plonge',
      lieuOfficiel: { acces_details: 'Quai n°2' },
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as {
      informations_supplementaires: string | null;
    };
    expect(collecte.informations_supplementaires).toContain(
      'Demander Karim à la plonge',
    );
    expect(collecte.informations_supplementaires).toContain('Accès : Quai n°2');
  });

  // Une collecte sans aucune information ne doit pas produire un champ libre
  // vide (pas de `comment` MTS-1 / `notes` Everest fabriqués de toutes pièces).
  it('lieu sans info d’accès et sans saisie → champ libre nul', async () => {
    const everestSpy = vi
      .spyOn(AdapterEverest.prototype, 'dispatchCollecte')
      .mockResolvedValue('adapter_everest');

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
      lieuOfficiel: { type_vehicule_max: '' },
    });
    await runOutboxWorker(supabase);

    const collecte = everestSpy.mock.calls[0]![0] as {
      informations_supplementaires: string | null;
    };
    expect(collecte.informations_supplementaires).toBeNull();
  });
});

// Étage 1 du bug M1.5 : `stationnement`, `acces_office` et `flux_autorises`
// n'étaient pas lus par fetchCollecte — ils n'arrivaient même pas au worker. Une
// colonne retirée du `select` ne casse rien de visible (PostgREST renvoie la
// ligne sans elle, la composition lit `undefined` et omet la ligne), donc aucun
// test de comportement ne l'attraperait : ce cliquet lit le `select` lui-même.
describe('M1.5 / fetchCollecte demande bien les colonnes d’accès du lieu', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    'acces_details',
    'contraintes_horaires',
    'type_vehicule_max',
    'stationnement',
    'acces_office',
    'flux_autorises',
  ])('la colonne %s est dans le select de collectes', async (colonne) => {
    vi.spyOn(AdapterEverest.prototype, 'dispatchCollecte').mockResolvedValue(
      'adapter_everest',
    );

    const supabase = makeWorkerSupabase({
      typeTms: 'a_toutes',
      prestataireLogistiqueId: PRESTA_ID,
    });
    await runOutboxWorker(supabase);

    const selects = (
      supabase as unknown as { _selects: Record<string, string[]> }
    )._selects['collectes'];
    expect(selects?.join(' ')).toContain(colonne);
  });
});
