// Cardinalité des embeds PostgREST autour de `collecte_tournees` — ancrage.
//
// POURQUOI CE FICHIER
// Les adapters MTS-1 et Everest lisaient l'embed `collecte_tournees → tournees`
// comme un TABLEAU (`ct.tournees[0]`) derrière un `as unknown as`. PostgREST
// renvoie un OBJET : la FK est portée par la table SOURCE
// (`collecte_tournees.tournee_id → tournees.id`), donc la relation est
// many-to-one. `[0]` valait donc `undefined` partout — E5 inerte, curseur
// d'idempotence toujours vide (donc re-POST d'un customerOrder à chaque retry,
// sur un MTS-1 présumé NON idempotent), `updateCollecte`/`cancelCollecte`
// bloqués sur `noop_no_remote`.
//
// Le cast masquait la faute à TypeScript, et tous les mocks encodaient la forme
// inventée par le code : aucun test ne pouvait la voir. La règle est simple —
// FK SORTANTE (portée par la table du `.from()`) → objet ; FK ENTRANTE → tableau.
//
// PREUVE (2026-09-15, projet savr-dev, service-role, lecture seule) :
//   GET /rest/v1/collecte_tournees
//       ?select=rang,tournees!inner(id,external_ref_commande,tms_reference,statut)
//   → [{"rang":1,"tournees":{"id":"1756cdd6-…","statut":"terminee", …}}]
//   `tournees` est un objet. Idem pour `collectes` embarqué depuis
//   `collecte_tournees` ; à l'inverse `collecte_tournees` embarqué depuis
//   `collectes` ou `tournees` est bien un tableau (FK entrante).
//
// CE QUE CE FICHIER GARANTIT
// 1. Un ancrage STATIQUE : la fixture est typée par l'inférence supabase-js sur
//    `database.types.ts`. Y remettre un tableau — ou voir la relation changer de
//    cardinalité — fait rougir `pnpm typecheck`, pas la production.
// 2. Un ancrage RUNTIME : les deux adapters consomment cette même fixture et
//    doivent trouver la tournée (pas de commande fantôme, pas de no-op).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../shared/src/database.types.js';
import type { Collecte, Lieu, Transporteur } from './index.js';
import { AdapterMts1 } from './mts1/adapter.js';
import { AdapterEverest } from './everest/adapter.js';
import { _setMts1Handlers } from './mts1/mock.js';
import { _setEverestHandlers, setupEverestMock } from './everest/mock.js';

// ─── Ancrage statique sur les types générés ──────────────────────────────────

// Client TYPÉ mais jamais instancié : sert uniquement de support d'inférence.
// Le client de production reste volontairement non typé (cf. le shim G7
// `packages/shared/src/supabase-client.typed.ts`) — on ne le touche pas ici.
declare const sbTypeOnly: SupabaseClient<Database, 'plateforme'>;

async function formeInfereeParSupabaseJs() {
  const { data } = await sbTypeOnly
    .from('collecte_tournees')
    .select(
      'rang, tournees!inner(id, external_ref_commande, tms_reference, statut)',
    );
  return data![0]!;
}

// Référence explicite : la fonction n'est là que pour son type de retour, elle
// n'est jamais appelée (`sbTypeOnly` n'existe pas au runtime).
void formeInfereeParSupabaseJs;

type LigneCollecteTournee = Awaited<
  ReturnType<typeof formeInfereeParSupabaseJs>
>;

// Si `tournees` redevenait un tableau, ce type vaudrait `never` et la fixture
// ci-dessous cesserait de compiler.
type EmbedTournee = LigneCollecteTournee['tournees'] extends readonly unknown[]
  ? never
  : LigneCollecteTournee['tournees'];

const TOURNEE_EMBED: EmbedTournee = {
  id: 'T-ancrage',
  external_ref_commande: 'ORDER-ancrage',
  tms_reference: 'TOUR-ancrage',
  statut: 'en_cours',
};

// La ligne complète, telle que PostgREST la renvoie.
const LIGNE_COLLECTE_TOURNEE = { rang: 1, tournees: TOURNEE_EMBED };

// ─── Fixtures ────────────────────────────────────────────────────────────────

const LIEU: Lieu = {
  id: 'lieu-ancrage',
  nom: 'Pavillon Gabriel',
  adresse_acces: '5 Avenue Gabriel',
  code_postal: '75008',
  ville: 'Paris',
  latitude: 48.87,
  longitude: 2.3,
  acces_details: null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null,
};

const COLLECTE: Collecte = {
  id: 'col-ancrage',
  type: 'zero_dechet',
  date_collecte: '2026-07-15',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
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

const TRANSPORTEUR_MTS1: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

const TRANSPORTEUR_EVEREST: Transporteur = {
  id: 'presta-002',
  type_tms: 'a_toutes',
  prestataire_logistique_id: 'presta-uuid-002',
};

// Mock Supabase minimal : `collecte_tournees` sert la ligne ancrée (thenable pour
// findTournees, maybeSingle pour findTournee), `collectes` sert la jointure E5.
function makeSupabase(): SupabaseClient {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  let table = '';

  Object.assign(builder, {
    select: vi.fn(chain),
    eq: vi.fn(chain),
    gte: vi.fn(chain),
    not: vi.fn(chain),
    update: vi.fn(chain),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn(async () =>
      table === 'collecte_tournees'
        ? { data: LIGNE_COLLECTE_TOURNEE, error: null }
        : { data: null, error: null },
    ),
    then: (resolve: (v: unknown) => void) => {
      if (table === 'collecte_tournees') {
        return resolve({ data: [LIGNE_COLLECTE_TOURNEE], error: null });
      }
      if (table === 'collectes') {
        return resolve({
          data: [
            {
              id: COLLECTE.id,
              nb_camions_demande: 1,
              date_collecte: COLLECTE.date_collecte,
              heure_collecte: COLLECTE.heure_collecte,
              type: COLLECTE.type,
              controle_acces_requis: false,
              informations_supplementaires: null,
              lieu_overrides: null,
              // FK entrante `collecte_tournees.collecte_id` → TABLEAU.
              collecte_tournees: [
                { tournee_id: TOURNEE_EMBED.id, ...LIGNE_COLLECTE_TOURNEE },
              ],
            },
          ],
          error: null,
        });
      }
      return resolve({ data: null, error: null });
    },
  });

  return {
    from: vi.fn((t: string) => {
      table = t;
      return builder;
    }),
  } as unknown as SupabaseClient;
}

// ─── Ancrage runtime ─────────────────────────────────────────────────────────

describe("cardinalité de l'embed collecte_tournees → tournees", () => {
  afterEach(() => {
    _setMts1Handlers(null);
    _setEverestHandlers(null);
  });

  it('MTS-1 / E5 — updateLieu lit la tournée et pousse bien le PUT (jamais inerte)', async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      createTour: vi.fn(),
      addCustomerOrder: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
      updateOrder,
    });

    await new AdapterMts1(TRANSPORTEUR_MTS1, makeSupabase()).updateLieu(LIEU);

    // Déballer l'embed comme un tableau donnait `undefined` → 0 appel.
    expect(updateOrder).toHaveBeenCalledTimes(1);
    expect(updateOrder.mock.calls[0]![0]).toBe(
      TOURNEE_EMBED.external_ref_commande,
    );
  });

  it("MTS-1 / E2 — updateCollecte voit la tournée existante et ne retombe pas sur 'noop_no_remote'", async () => {
    const updateOrder = vi.fn().mockResolvedValue(undefined);
    _setMts1Handlers({
      pollOrders: vi.fn(),
      getTour: vi.fn(),
      postOrder: vi.fn(),
      createTour: vi.fn(),
      addCustomerOrder: vi.fn(),
      dispatchTour: vi.fn(),
      validateTour: vi.fn(),
      updateOrder,
    });

    const consumer = await new AdapterMts1(
      TRANSPORTEUR_MTS1,
      makeSupabase(),
    ).updateCollecte(COLLECTE);

    expect(consumer).toBe('adapter_mts1');
  });

  it("Everest / E3 — cancelCollecte voit la tournée existante et ne retombe pas sur 'noop_no_remote'", async () => {
    setupEverestMock();

    const consumer = await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      makeSupabase(),
    ).cancelCollecte(COLLECTE);

    expect(consumer).not.toBe('noop_no_remote');
  });
});
