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

    expect(result.customerOrders).toHaveLength(3);
    expect(result.totalCount).toBe(3);
    restore();
  });

  it('M0.11 / MTS-1 — poll nominal contient un ordre OK', async () => {
    const restore = setupMts1Mock({ poll: 'nominal' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();

    expect(result.customerOrders.map((o) => o.status)).toContain('OK');
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
    const stuffs = tour.stops.flatMap((s) =>
      (s.items ?? []).map((i) => i.stuff),
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
    const stuffs = tour.stops.flatMap((s) =>
      (s.items ?? []).map((i) => i.stuff),
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

    expect(result.customerOrders).toHaveLength(2);
    for (const order of result.customerOrders) {
      expect(TERMINAUX.has(order.status)).toBe(true);
    }
    restore();
  });

  it('M0.11 / MTS-1 — multi-camions N=2 : ≥1 OK/PARTIAL présent (déclenchement realisee attendu)', async () => {
    const restore = setupMts1Mock({ poll: 'multi_camions' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();
    const hasOkOrPartial = result.customerOrders.some(
      (o) => o.status === 'OK' || o.status === 'PARTIAL',
    );

    expect(hasOkOrPartial).toBe(true);
    restore();
  });

  it('M0.11 / MTS-1 — KO total tous CANCELED/KO → rejetee_par_prestataire attendu', async () => {
    const restore = setupMts1Mock({ poll: 'ko_partiel' });
    const handlers = _getMts1Handlers()!;
    const result = await handlers.pollOrders();
    const allKo = result.customerOrders.every(
      (o) => o.status === 'CANCELED' || o.status === 'KO',
    );

    expect(allKo).toBe(true);
    expect(result.customerOrders).toHaveLength(2);
    restore();
  });
});

describe('M0.11 / MTS-1 — pesées incomplètes', () => {
  it('M0.11 / MTS-1 — pesées incomplètes : tour OK sans items flux (batch J+1 skip attendu)', async () => {
    const restore = setupMts1Mock({ tour: 'pesees_incompletes' });
    const handlers = _getMts1Handlers()!;
    const tour = await handlers.getTour('MTS1-TOUR-INCOMPLETE-001');

    expect(tour.status).toBe('OK');
    const fluxItems = tour.stops
      .flatMap((s) => s.items ?? [])
      .filter((i) => i.stuff !== '<volume_du_camion>');
    expect(fluxItems).toHaveLength(0);
    restore();
  });
});

describe('M0.11 / MTS-1 — photos', () => {
  it('M0.11 / MTS-1 — photo 404 non bloquante : getPhotos retourne sans erreur même avec URL 404', async () => {
    const restore = setupMts1Mock({ photosUrl404: true });
    const handlers = _getMts1Handlers()!;
    const photos = await handlers.getPhotos!('MTS1-TOUR-AG-001');

    expect(photos.length).toBeGreaterThan(0);
    for (const p of photos) {
      expect(p.url).toContain('not-found-404');
    }
    restore();
  });

  it('M0.11 / MTS-1 — photos nominales : clé dédup (tourId, stopId, photoId) unique par photo', async () => {
    const restore = setupMts1Mock({});
    const handlers = _getMts1Handlers()!;
    const photos = await handlers.getPhotos!('MTS1-TOUR-AG-001');
    const keys = photos.map((p) => `${p.tourId}|${p.stopId}|${p.photoId}`);

    expect(new Set(keys).size).toBe(photos.length);
    restore();
  });
});
