import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  _getMts1Handlers,
  _setMts1Handlers,
  getMts1FluxLibelles,
  setupMts1Mock,
} from './mock.js';

const FIXTURES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../fixtures/api/mts1',
);

function loadMts1Fixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, filename), 'utf-8'),
  ) as T;
}

afterEach(() => {
  _setMts1Handlers(null);
});

describe('M0.11 / MTS-1 — infrastructure mock', () => {
  it('M0.11 / MTS-1 — _setMts1Handlers / _getMts1Handlers injectable', () => {
    expect(_getMts1Handlers()).toBeNull();

    const restore = setupMts1Mock({ poll: 'nominal' });
    expect(_getMts1Handlers()).not.toBeNull();

    restore();
    expect(_getMts1Handlers()).toBeNull();
  });
});

describe('M0.11 / MTS-1 — poll nominal', () => {
  it('M0.11 / MTS-1 — poll nominal retourne 3 commandes', async () => {
    const restore = setupMts1Mock({ poll: 'nominal' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();

    // Tableau nu, comme le fil : ni enveloppe ni compteur de pagination.
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3);
    restore();
  });

  it('M0.11 / MTS-1 — poll nominal contient un ordre OK', async () => {
    const restore = setupMts1Mock({ poll: 'nominal' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();

    expect(result.map((o) => o.customerOrderStatus)).toContain('OK');
    restore();
  });
});

describe('M0.11 / MTS-1 — déduplication', () => {
  it('M0.11 / MTS-1 — fixture dedup : payload_a et payload_b ont le même event_id', () => {
    const raw = loadMts1Fixture<{
      payload_a: { event_id: string };
      payload_b: { event_id: string };
    }>('poll_dedup_pair.json');

    expect(raw.payload_a.event_id).toBe(raw.payload_b.event_id);
    expect(raw.payload_a.event_id).toBeTruthy();
  });
});

describe('M0.11 / MTS-1 — tour / pesées / libellés as-built', () => {
  it('M0.11 / MTS-1 — tour nominal contient les 5 libellés flux as-built exacts', async () => {
    const restore = setupMts1Mock({ tour: 'nominal' });
    const handlers = _getMts1Handlers()!;
    const tour = await handlers.getTour('MTS1-TOUR-ZD-001');
    const stuffs = (tour.stops ?? []).flatMap((s) =>
      (s.stuffs ?? []).map((i) => i.name),
    );

    expect(stuffs).toContain('Bio-déchets (en kg)');
    expect(stuffs).toContain('Carton (en kg)');
    expect(stuffs).toContain('D.I.B (en kg)');
    expect(stuffs).toContain('Film plastique (en kg)');
    expect(stuffs).toContain('Verre (en kg)');
    expect(stuffs).toContain('<volume_du_camion>');
    restore();
  });

  it('M0.11 / MTS-1 — mapping libellés flux : 6 entrées dont _ignore pour volume_du_camion', () => {
    const mapping = getMts1FluxLibelles();

    expect(mapping['Bio-déchets (en kg)']).toBe('biodechets');
    expect(mapping['Carton (en kg)']).toBe('carton');
    expect(mapping['D.I.B (en kg)']).toBe('dib');
    expect(mapping['Film plastique (en kg)']).toBe('film_plastique');
    expect(mapping['Verre (en kg)']).toBe('verre');
    expect(mapping['<volume_du_camion>']).toBe('_ignore');
  });

  it('M0.11 / MTS-1 — stuff inconnu présent dans fixture stuff_inconnu (alerte Ops attendue côté adapter)', async () => {
    const restore = setupMts1Mock({ tour: 'stuff_inconnu' });
    const handlers = _getMts1Handlers()!;
    const tour = await handlers.getTour('MTS1-TOUR-ZD-002');
    const stuffs = (tour.stops ?? []).flatMap((s) =>
      (s.stuffs ?? []).map((i) => i.name),
    );

    expect(stuffs).toContain('Gravats (en kg)');
    restore();
  });
});

describe('M0.11 / MTS-1 — POST order', () => {
  it('M0.11 / MTS-1 — POST 201 crée un customerOrder (ok: true)', async () => {
    const restore = setupMts1Mock({ post: 'success' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.postOrder({ externalReference: 'test-ref' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toMatch(/^MTS1-ORDER/);
      expect(result.status).toBe('DRAFT');
    }
    restore();
  });

  it('M0.11 / MTS-1 — POST 422 rejet validation (ok: false, status 422)', async () => {
    const restore = setupMts1Mock({ post: 'rejet_422' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.postOrder({ externalReference: 'test-ref' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.error).toBe('VALIDATION_ERROR');
    }
    restore();
  });

  it("M0.11 / MTS-1 — POST timeout → plan B scan minDate/maxDate retrouve l'ordre", async () => {
    const restore = setupMts1Mock({ post: 'timeout_plan_b' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.postOrder({
      externalReference: 'col_timeout_001-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalReference).toBe('col_timeout_001-1');
      expect(result.id).toMatch(/^MTS1-ORDER-TIMEOUT/);
    }
    restore();
  });
});

describe('M0.11 / MTS-1 — scénarios multi-camions et KO', () => {
  it('M0.11 / MTS-1 — multi-camions N=2 : les deux ordres sont en état terminal', async () => {
    const restore = setupMts1Mock({ poll: 'multi_camions' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();
    const TERMINAUX = new Set(['OK', 'PARTIAL', 'CANCELED', 'KO']);

    expect(result).toHaveLength(2);
    for (const order of result) {
      expect(TERMINAUX.has(order.customerOrderStatus)).toBe(true);
    }
    restore();
  });

  it('M0.11 / MTS-1 — multi-camions N=2 : ≥1 OK/PARTIAL présent (déclenchement realisee attendu)', async () => {
    const restore = setupMts1Mock({ poll: 'multi_camions' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();
    const hasOkOrPartial = result.some(
      (o) =>
        o.customerOrderStatus === 'OK' || o.customerOrderStatus === 'PARTIAL',
    );

    expect(hasOkOrPartial).toBe(true);
    restore();
  });

  it('M0.11 / MTS-1 — KO total tous CANCELED/KO → rejetee_par_prestataire attendu', async () => {
    const restore = setupMts1Mock({ poll: 'ko_partiel' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();
    const allKo = result.every(
      (o) =>
        o.customerOrderStatus === 'CANCELED' || o.customerOrderStatus === 'KO',
    );

    expect(allKo).toBe(true);
    expect(result).toHaveLength(2);
    restore();
  });
});

describe('M0.11 / MTS-1 — pesées incomplètes', () => {
  it('M0.11 / MTS-1 — pesées incomplètes : tour terminé sans poids de flux (batch J+1 skip attendu)', async () => {
    const restore = setupMts1Mock({ tour: 'pesees_incompletes' });
    const handlers = _getMts1Handlers()!;
    const tour = await handlers.getTour('MTS1-TOUR-INCOMPLETE-001');

    expect(tour.status?.progression).toBe('FINISHED');
    const fluxPeses = (tour.stops ?? [])
      .flatMap((s) => s.stuffs ?? [])
      .filter(
        (i) => i.name !== '<volume_du_camion>' && i.quantityAfterPickup != null,
      );
    expect(fluxPeses).toHaveLength(0);
    restore();
  });
});

describe('M0.11 / MTS-1 — photos', () => {
  it('M0.11 / MTS-1 — photo absente non bloquante : le téléchargement simulé rend null sans erreur', async () => {
    const restore = setupMts1Mock({ tour: 'photos', photoAbsente: true });
    const handlers = _getMts1Handlers()!;
    const tour = await handlers.getTour('MTS1-TOUR-AG-001');
    const adresses = (tour.stops ?? []).flatMap((s) =>
      (s.photos ?? []).map((p) => p.downloadUrl),
    );

    expect(adresses.length).toBeGreaterThan(0);
    for (const adresse of adresses) {
      await expect(handlers.downloadPhoto!(adresse)).resolves.toBeNull();
    }
    restore();
  });

  it('M0.11 / MTS-1 — photos nominales : clé dédup (tourId, stopId, photoId) unique par photo', async () => {
    const restore = setupMts1Mock({ tour: 'photos' });
    const handlers = _getMts1Handlers()!;
    const tour = await handlers.getTour('MTS1-TOUR-AG-001');
    // Les photos sont dans le détail du tour, sur l'enlèvement et sur le dépôt ;
    // rien d'autre que l'adresse n'identifie une photo.
    const keys = (tour.stops ?? []).flatMap((s) =>
      (s.photos ?? []).map((p) => {
        expect(Object.keys(p)).toEqual(['downloadUrl']);
        const [tourId, stopId, photoId] = new URL(p.downloadUrl).pathname
          .split('/')
          .slice(-3);
        expect(tourId).toBe(tour.tourId);
        expect(stopId).toBe(s.stopId);
        return `${tourId}|${stopId}|${photoId}`;
      }),
    );

    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(keys.length);
    restore();
  });
});
