import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Collecte, Lieu, Transporteur } from '../index.js';
import { AdapterMts1 } from './adapter.js';
import type { Mts1CreatedTour } from './mock.js';
import { _setMts1Handlers } from './mock.js';

// =============================================================================
// E2 `collecte.modifiee` — le PUT /v3/customerOrders doit repousser TOUT champ
// que la Plateforme déclare « propagé au TMS ».
//
// Cette déclaration n'est pas une opinion : elle est portée par le trigger DB
// `fn_set_collectes_dirty_tms`, dont la liste de champs EST la définition de
// « champ propagé au TMS » (§04 Data Model l.1512 « date, heure, lieu, contrôle
// d'accès, info supplémentaire » ; §08 3bis.8 « re-push des champs modifiés
// (créneau, volume, contact) » ; Interface logistique_provider §2 E2).
//
// Deux des cinq champs n'atteignaient pas le fil — le CRÉNEAU (`heure_collecte`,
// nommé en tête de la 3bis.8) et le CANAL LIBRE (`informations_supplementaires`,
// seul véhicule des informations d'accès du lieu, arbitrage Val 2026-09-15).
// Une correction d'horaire ou d'accès sur une collecte déjà dispatchée était
// stockée, auditée, badgée — et jamais transmise au chauffeur.
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

const COLLECTE_DISPATCHEE: Collecte = {
  id: 'col-e2-001',
  type: 'zero_dechet',
  date_collecte: '2026-09-20',
  heure_collecte: '22:30:00',
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

const TRANSPORTEUR: Transporteur = {
  id: 'presta-001',
  type_tms: 'mts1',
  code_transporteur_mts1: 'STRIKE-IDF',
  prestataire_logistique_id: 'presta-uuid-001',
};

// Mock Supabase : une tournée rang 1 déjà commandée chez MTS-1 → updateCollecte
// procède au PUT (sinon `avecRef.length === 0` → no-op `noop_no_remote`).
//
// `tournees` est servi en OBJET : la FK est portée par la table source
// (`collecte_tournees.tournee_id` → `tournees.id`), donc PostgREST renvoie un
// objet, jamais un tableau. Ce fichier épingle le CONTENU du payload ; la forme
// de l'embed est ancrée par `embed-cardinalite.test.ts`.
function mockSupabaseDispatched() {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({
      data: [
        {
          rang: 1,
          tournees: {
            id: 'tournee-e2-001',
            external_ref_commande: 'MTS1-ORDER-E2-001',
            tms_reference: 'MTS1-TOUR-E2-001',
            statut: 'en_cours',
          },
        },
      ],
      error: null,
    }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn().mockReturnValue(mockQuery),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

// Mock Supabase pour E1 (dispatchCollecte) : aucune tournée existante.
function mockSupabaseVierge() {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'tournee-new-e2',
        external_ref_commande: 'MTS1-ORDER-NEW-E2',
        tms_reference: null,
        statut: 'planifiee',
      },
      error: null,
    }),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
  };
  return {
    from: vi.fn().mockReturnValue(mockQuery),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

/** Joue E2 sur `collecte` et rend le corps du PUT réellement adressé à MTS-1. */
async function putPayload(
  collecte: Collecte,
): Promise<Record<string, unknown>> {
  const updateOrder = vi.fn().mockResolvedValue(undefined);
  _setMts1Handlers({
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder: vi.fn(),
    updateOrder,
  });
  await new AdapterMts1(TRANSPORTEUR, mockSupabaseDispatched()).updateCollecte(
    collecte,
  );
  expect(updateOrder).toHaveBeenCalledOnce();
  return updateOrder.mock.calls[0]![1] as Record<string, unknown>;
}

/** Joue E1 sur `collecte` et rend le corps du POST réellement adressé à MTS-1. */
async function postPayload(
  collecte: Collecte,
): Promise<Record<string, unknown>> {
  const postOrder = vi.fn().mockResolvedValue({
    ok: true,
    id: 'MTS1-ORDER-NEW-E2',
    externalReference: `${collecte.id}-1`,
    status: 'PLANNED',
    createdAt: '',
  });
  _setMts1Handlers({
    pollOrders: vi.fn(),
    getTour: vi.fn(),
    postOrder,
    createTour: vi.fn().mockResolvedValue({
      tourId: 'MTS1-TOUR-NEW-E2',
      externalReference: `${collecte.id}-1`,
      status: 'DRAFT',
      createdAt: '',
      customerOrderId: 'MTS1-ORDER-NEW-E2',
    } satisfies Mts1CreatedTour),
    addCustomerOrder: vi.fn().mockResolvedValue(undefined),
    dispatchTour: vi.fn().mockResolvedValue(undefined),
    validateTour: vi.fn().mockResolvedValue(undefined),
  });
  await new AdapterMts1(TRANSPORTEUR, mockSupabaseVierge()).dispatchCollecte(
    collecte,
    1,
  );
  expect(postOrder).toHaveBeenCalledOnce();
  return postOrder.mock.calls[0]![0] as Record<string, unknown>;
}

describe('E2 — le canal libre (informations_supplementaires) atteint le chauffeur', () => {
  afterEach(() => _setMts1Handlers(null));

  it('E2 — une consigne d’accès saisie après dispatch part en `comment`', async () => {
    const payload = await putPayload({
      ...COLLECTE_DISPATCHEE,
      informations_supplementaires:
        'Stationnement : cour intérieure, quai 3. Accès office : difficile.',
    });

    expect(payload['comment']).toBe(
      'Stationnement : cour intérieure, quai 3. Accès office : difficile.',
    );
  });

  it('E2 — une consigne EFFACÉE efface aussi celle de MTS-1 (clé présente, valeur vide)', async () => {
    // Le PUT étant un merge partiel, omettre la clé laisserait le chauffeur avec
    // la consigne PÉRIMÉE d'un E1 antérieur : c'est le bug corrigé, à l'envers.
    const payload = await putPayload({
      ...COLLECTE_DISPATCHEE,
      informations_supplementaires: null,
    });

    expect(payload).toHaveProperty('comment');
    expect(payload['comment']).toBe('');
  });

  it('E2 — le `comment` VARIE avec la collecte (il n’est pas constant)', async () => {
    // Oracle différentiel : une clé posée en dur passerait les deux cas ci-dessus
    // si l'un d'eux était supprimé ; deux collectes qui ne diffèrent QUE par le
    // canal libre doivent produire deux payloads différents.
    const a = await putPayload({
      ...COLLECTE_DISPATCHEE,
      informations_supplementaires: 'Entrée par le quai 3',
    });
    const b = await putPayload({
      ...COLLECTE_DISPATCHEE,
      informations_supplementaires: 'Entrée par la rue de Courcelles',
    });

    expect(a['comment']).not.toEqual(b['comment']);
  });
});

describe('E2 — le créneau (heure_collecte) atteint le chauffeur', () => {
  afterEach(() => _setMts1Handlers(null));

  it('E2 — `place.timeslots` est repoussé au format HH:mm (point fixe start=end)', async () => {
    const payload = await putPayload({
      ...COLLECTE_DISPATCHEE,
      heure_collecte: '06:45:00',
    });

    const place = payload['place'] as {
      address?: { addressSingleLine?: string };
      timeslots?: { start: string; end: string }[];
    };
    expect(place.timeslots).toEqual([{ start: '06:45', end: '06:45' }]);
    // L'adresse ne doit pas avoir été perdue en chemin : `place` porte les deux.
    expect(place.address?.addressSingleLine).toContain('75008');
  });

  it('E2 — le créneau VARIE avec la collecte (il n’est pas constant)', async () => {
    const a = await putPayload({
      ...COLLECTE_DISPATCHEE,
      heure_collecte: '06:45:00',
    });
    const b = await putPayload({
      ...COLLECTE_DISPATCHEE,
      heure_collecte: '23:15:00',
    });

    expect((a['place'] as Record<string, unknown>)['timeslots']).not.toEqual(
      (b['place'] as Record<string, unknown>)['timeslots'],
    );
  });
});

describe('E1/E2 — rien d’INTERNE ne sort vers le prestataire', () => {
  afterEach(() => _setMts1Handlers(null));

  // `collectes.notes_internes` est chargée par le worker et portée par le type
  // `Collecte` jusque dans les builders : elle est donc à PORTÉE DE MAIN de tout
  // payload sortant, et rien dans les tests ne l'en empêchait. Deux mutations
  // plausibles passaient typecheck ET suite verte (relevé reviewer-rls-securite) :
  // une clé `internalNote:` ajoutée au PUT, et la note concaténée dans `comment`.
  // Le typage `Partial<CreateOrderPayload>` tue la première ; ce cas tue la seconde.
  const SENTINELLE = 'SENTINELLE-INTERNE-NE-DOIT-PAS-SORTIR';
  const COLLECTE_AVEC_NOTE: Collecte = {
    ...COLLECTE_DISPATCHEE,
    informations_supplementaires: 'Quai 3, sonner à l’interphone',
    notes_internes: SENTINELLE,
  };

  // Les deux types sont joués : les builders branchent DÉJÀ sur `isZd`
  // (`orderCategories`, `stuffs`), donc une fuite conditionnelle au type est un
  // motif plausible ici — et elle échappe aux deux autres gardes, le compilateur
  // comme l'assertion de clés (démontré par sonde, reviewer-rls-securite).
  const TYPES: Collecte['type'][] = ['zero_dechet', 'anti_gaspi'];

  it.each(TYPES)(
    'E2 (%s) — la note interne n’apparaît nulle part dans le corps du PUT',
    async (type) => {
      const payload = await putPayload({ ...COLLECTE_AVEC_NOTE, type });
      expect(JSON.stringify(payload)).not.toContain(SENTINELLE);
    },
  );

  it.each(TYPES)(
    'E1 (%s) — la note interne n’apparaît nulle part dans le corps du POST',
    async (type) => {
      const payload = await postPayload({ ...COLLECTE_AVEC_NOTE, type });
      expect(JSON.stringify(payload)).not.toContain(SENTINELLE);
    },
  );

  it('E2 — le corps du PUT porte EXACTEMENT les clés attendues', async () => {
    // Borne les clés plutôt que leur seul contenu : une clé ajoutée par mégarde
    // (un champ interne, un reliquat de debug) rougit ici même si elle est vide et
    // même si aucune assertion de valeur ne la regarde. La fixture porte un
    // contact, donc `contact` est attendu ; sans contact la clé est omise.
    const payload = await putPayload(COLLECTE_AVEC_NOTE);
    expect(Object.keys(payload).sort()).toEqual([
      'comment',
      'contact',
      'orderDate',
      'place',
    ]);
  });
});

describe('E1/E2 — parité du point A par construction', () => {
  afterEach(() => _setMts1Handlers(null));

  it('E1/E2 — pour une même collecte, le `place` créé et le `place` modifié sont identiques', async () => {
    // C'est la propriété que la divergence a violée : `place` était construit
    // deux fois, et seule la copie E1 portait le créneau. Un écart ici signifie
    // qu'un dispatch et une modification ne décrivent pas le même enlèvement.
    const collecte: Collecte = {
      ...COLLECTE_DISPATCHEE,
      heure_collecte: '07:00:00',
      informations_supplementaires: 'Sonner à l’interphone « Livraisons »',
    };

    const e1 = await postPayload(collecte);
    const e2 = await putPayload(collecte);

    expect(e2['place']).toEqual(e1['place']);
    expect(e2['comment']).toEqual(e1['comment']);
    expect(e2['orderDate']).toEqual(e1['orderDate']);
  });
});

// ─── Cliquet : la liste du trigger DB est l'oracle ───────────────────────────

/**
 * Champs armant `dirty_tms` → contrepartie dans le payload E2.
 *
 * Toute entrée `null` est une EXCLUSION ASSUMÉE, qui doit porter sa raison.
 * Ajouter un champ au trigger sans l'ajouter ici fait rougir ce test : c'est le
 * seul endroit où « propagé au TMS » (déclaration DB) et « réellement poussé »
 * (payload) sont confrontés.
 */
const MAPPING_E2: Record<string, { cle: string } | { exclu: string }> = {
  date_collecte: { cle: 'orderDate' },
  heure_collecte: { cle: 'place.timeslots' },
  lieu_overrides: { cle: 'place.address' },
  informations_supplementaires: { cle: 'comment' },
  // MTS-1 n'a aucun champ natif pour le contrôle d'accès (concern V2 TMS via
  // validate_tournee_controle_acces) — hors payload sortant V1, déjà tracé.
  controle_acces_requis: { exclu: 'aucun champ natif MTS-1 (V1)' },
};

/** Champs comparés par `fn_set_collectes_dirty_tms`, lus dans la migration. */
function champsDirtyTms(): string[] {
  // Résolu depuis CE fichier (packages/adapters/src/mts1/) et non depuis
  // `process.cwd()`, qui vaut la racine du repo quand vitest est lancé en
  // workspace et le dossier du package quand il est lancé par `test:module`.
  const dir = fileURLToPath(
    new URL('../../../../supabase/migrations', import.meta.url),
  );
  const fichiers = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // La dernière migration qui (re)définit la fonction fait foi.
  let corps: string | null = null;
  for (const f of fichiers) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const i = sql.indexOf('FUNCTION plateforme.fn_set_collectes_dirty_tms');
    if (i === -1) continue;
    const fin = sql.indexOf('$$;', i);
    corps = sql.slice(i, fin === -1 ? undefined : fin);
  }
  expect(
    corps,
    'fn_set_collectes_dirty_tms introuvable dans les migrations',
  ).not.toBeNull();
  const champs = [
    ...new Set(
      [...corps!.matchAll(/OLD\.(\w+)\s+IS DISTINCT FROM\s+NEW\.\1/gi)].map(
        (m) => m[1]!.toLowerCase(),
      ),
    ),
  ].sort();
  // Filet anti-faux-vert du parseur : une comparaison écrite dans l'autre sens
  // (`NEW.x IS DISTINCT FROM OLD.x`) échapperait à la regex, le champ manquerait
  // des DEUX listes et la divergence passerait inaperçue. On exige donc que
  // chaque comparaison du corps ait été reconnue. Les deux regex sont `i` : en
  // minuscules, SQL valide, la comparaison échapperait sinon au filet LUI-MÊME
  // (elle manquerait des deux comptages à la fois, donc sans écart à signaler).
  const comparaisons = [...corps!.matchAll(/IS DISTINCT FROM/gi)].length;
  expect(
    champs.length,
    'une comparaison de fn_set_collectes_dirty_tms n’a pas été reconnue par le parseur',
  ).toBe(comparaisons);
  return champs;
}

describe('Cliquet — tout champ « propagé au TMS » a une contrepartie E2', () => {
  afterEach(() => _setMts1Handlers(null));

  it('cliquet — la liste du trigger DB et la table de mapping ne divergent pas', () => {
    expect(champsDirtyTms()).toEqual(Object.keys(MAPPING_E2).sort());
  });

  it('cliquet — chaque champ mappé fait effectivement varier le PUT', async () => {
    // Variantes ne différant QUE par le champ testé. Preuve d'atteinte du fil :
    // si le payload est identique, le champ ne part pas — quel que soit le code.
    const variantes: Record<string, [Partial<Collecte>, Partial<Collecte>]> = {
      date_collecte: [
        { date_collecte: '2026-09-20' },
        { date_collecte: '2026-09-21' },
      ],
      heure_collecte: [
        { heure_collecte: '06:45:00' },
        { heure_collecte: '23:15:00' },
      ],
      lieu_overrides: [
        { lieu: { ...LIEU_FIXTURE, adresse_acces: '1 rue A' } },
        { lieu: { ...LIEU_FIXTURE, adresse_acces: '2 rue B' } },
      ],
      informations_supplementaires: [
        { informations_supplementaires: 'Quai 3' },
        { informations_supplementaires: 'Quai 4' },
      ],
    };

    for (const [champ, [va, vb]] of Object.entries(variantes)) {
      const a = await putPayload({ ...COLLECTE_DISPATCHEE, ...va });
      const b = await putPayload({ ...COLLECTE_DISPATCHEE, ...vb });
      expect(
        JSON.stringify(a),
        `le champ « ${champ} » n'atteint pas le PUT E2`,
      ).not.toEqual(JSON.stringify(b));
    }
  });
});
