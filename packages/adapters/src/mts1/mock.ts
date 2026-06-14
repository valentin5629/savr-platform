import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../fixtures/api/mts1');

function loadFixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(resolve(FIXTURES_DIR, filename), 'utf-8'),
  ) as T;
}

// ─── Types as-built MTS-1 ────────────────────────────────────────────────────

export type Mts1OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'DELIVERED'
  | 'PARTIAL'
  | 'CANCELED'
  | 'KO';

export interface Mts1Stop {
  stopId: string;
  address: string;
  status?: string;
  completedAt?: string | null;
}

export interface Mts1CustomerOrder {
  id: string;
  externalReference: string;
  status: Mts1OrderStatus;
  pickupDate?: string | null;
  deliveryDate?: string | null;
  stops?: Mts1Stop[];
}

export interface Mts1StopItem {
  stuff: string;
  qty: number;
  weight: number | null;
}

export interface Mts1TourStop {
  stopId: string;
  address: string;
  completedAt?: string | null;
  items?: Mts1StopItem[];
}

export interface Mts1Tour {
  tourId: string;
  externalReference: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  stops: Mts1TourStop[];
}

export interface Mts1Photo {
  tourId: string;
  stopId: string;
  photoId: string;
  url: string;
  takenAt: string;
  type: string;
  weight_kg: number | null;
}

export interface Mts1PollResult {
  customerOrders: Mts1CustomerOrder[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export type Mts1PostSuccess = {
  ok: true;
  id: string;
  externalReference: string;
  status: Mts1OrderStatus;
  createdAt: string;
};

export type Mts1PostError = {
  ok: false;
  status: number;
  error: string;
  message: string;
};

export type Mts1PostResult = Mts1PostSuccess | Mts1PostError;

// ─── Injectable handlers (consumed by adapter MTS-1 in M1.5) ─────────────────

export interface Mts1CreatedTour {
  tourId: string;
  externalReference: string;
  status: string;
  createdAt: string;
  customerOrderId: string;
}

export interface Mts1Handlers {
  // M1.5b — entrant
  pollOrders: () => Promise<Mts1PollResult>;
  getTour: (tourId: string) => Promise<Mts1Tour>;
  getPhotos?: (tourId: string) => Promise<Mts1Photo[]>;
  // M1.5a — sortant
  postOrder: (payload: Record<string, unknown>) => Promise<Mts1PostResult>;
  createTour?: (payload: Record<string, unknown>) => Promise<Mts1CreatedTour>;
  dispatchTour?: (
    tourId: string,
    carrierShareableCode: string,
  ) => Promise<void>;
  validateTour?: (tourId: string) => Promise<void>;
  updateOrder?: (
    orderId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  deleteOrder?: (orderId: string) => Promise<void>;
  scanOrdersByDateRange?: (
    minDate: string,
    maxDate: string,
  ) => Promise<Mts1CustomerOrder[]>;
}

let _handlers: Mts1Handlers | null = null;

export function _setMts1Handlers(handlers: Mts1Handlers | null): void {
  _handlers = handlers;
}

export function _getMts1Handlers(): Mts1Handlers | null {
  return _handlers;
}

// ─── Fixture-based setup helpers ──────────────────────────────────────────────

export type Mts1PollScenario =
  | 'nominal'
  | 'dedup'
  | 'multi_camions'
  | 'ko_partiel'
  | 'pesees_incompletes';

interface PollFixture {
  customerOrders?: Mts1CustomerOrder[];
  payload_a?: { event_id: string };
  payload_b?: { event_id: string };
}

interface MultiCamionsFixture {
  customerOrders: Mts1CustomerOrder[];
  tours: Mts1Tour[];
}

const POLL_SCENARIOS: Record<Mts1PollScenario, () => Mts1PollResult> = {
  nominal: () => loadFixture<Mts1PollResult>('poll_statuts_nominal.json'),
  dedup: () => {
    const f = loadFixture<PollFixture>('poll_dedup_pair.json');
    return {
      customerOrders: [
        {
          id: 'MTS1-DEDUP-001',
          externalReference: f.payload_a?.event_id ?? 'dedup-ref',
          status: 'DELIVERED',
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50,
    };
  },
  multi_camions: () => {
    const f = loadFixture<MultiCamionsFixture>('tours_multi_camions.json');
    return {
      customerOrders: f.customerOrders,
      totalCount: f.customerOrders.length,
      page: 1,
      pageSize: 50,
    };
  },
  ko_partiel: () => {
    const f = loadFixture<{ customerOrders: Mts1CustomerOrder[] }>(
      'tours_ko_partiel.json',
    );
    return {
      customerOrders: f.customerOrders,
      totalCount: f.customerOrders.length,
      page: 1,
      pageSize: 50,
    };
  },
  pesees_incompletes: () => {
    const f = loadFixture<{ tour: Mts1Tour }>('tours_pesees_incompletes.json');
    return {
      customerOrders: [
        {
          id: f.tour.tourId,
          externalReference: f.tour.externalReference,
          status: 'DELIVERED',
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50,
    };
  },
};

export type Mts1TourScenario =
  | 'nominal'
  | 'stuff_inconnu'
  | 'multi_camions_tour1'
  | 'multi_camions_tour2'
  | 'pesees_incompletes';

interface ToursFixture {
  tour_nominal?: Mts1Tour;
  tour_stuff_inconnu?: Mts1Tour;
}

interface TourMultiFixture {
  tours: Mts1Tour[];
}

const TOUR_SCENARIOS: Record<Mts1TourScenario, () => Mts1Tour> = {
  nominal: () => {
    const f = loadFixture<ToursFixture>('tours_pesees_flux.json');
    if (!f.tour_nominal) throw new Error('fixture manquante: tour_nominal');
    return f.tour_nominal;
  },
  stuff_inconnu: () => {
    const f = loadFixture<ToursFixture>('tours_pesees_flux.json');
    if (!f.tour_stuff_inconnu)
      throw new Error('fixture manquante: tour_stuff_inconnu');
    return f.tour_stuff_inconnu;
  },
  multi_camions_tour1: () => {
    const f = loadFixture<TourMultiFixture>('tours_multi_camions.json');
    if (!f.tours[0]) throw new Error('fixture manquante: tours[0]');
    return f.tours[0];
  },
  multi_camions_tour2: () => {
    const f = loadFixture<TourMultiFixture>('tours_multi_camions.json');
    if (!f.tours[1]) throw new Error('fixture manquante: tours[1]');
    return f.tours[1];
  },
  pesees_incompletes: () => {
    const f = loadFixture<{ tour: Mts1Tour }>('tours_pesees_incompletes.json');
    return f.tour;
  },
};

export type Mts1PostScenario = 'success' | 'rejet_422' | 'timeout_plan_b';

interface PostOkFixture {
  id: string;
  externalReference: string;
  status: Mts1OrderStatus;
  createdAt: string;
}

interface PostErrorFixture {
  status: number;
  error: string;
  message: string;
}

interface TimeoutFixture {
  plan_b_scan: {
    response: {
      customerOrders: Mts1CustomerOrder[];
    };
  };
}

const POST_SCENARIOS: Record<Mts1PostScenario, () => Mts1PostResult> = {
  success: () => {
    const f = loadFixture<PostOkFixture>('envoi_ordre_ok.json');
    return {
      ok: true,
      id: f.id,
      externalReference: f.externalReference,
      status: f.status,
      createdAt: f.createdAt,
    };
  },
  rejet_422: () => {
    const f = loadFixture<PostErrorFixture>('envoi_ordre_rejet_4xx.json');
    return { ok: false, status: f.status, error: f.error, message: f.message };
  },
  timeout_plan_b: () => {
    const f = loadFixture<TimeoutFixture>('post_timeout.json');
    const order = f.plan_b_scan.response.customerOrders[0];
    if (!order)
      throw new Error(
        'fixture manquante: plan_b_scan.response.customerOrders[0]',
      );
    return {
      ok: true,
      id: order.id,
      externalReference: order.externalReference,
      status: order.status,
      createdAt: '',
    };
  },
};

/**
 * Configure les handlers MTS-1 avec des données fixture.
 * Retourne une fonction de teardown à appeler dans afterEach.
 *
 * @example
 * const restore = setupMts1Mock({ poll: 'nominal', post: 'success' });
 * afterEach(restore);
 */
export function setupMts1Mock(opts: {
  poll?: Mts1PollScenario;
  tour?: Mts1TourScenario;
  post?: Mts1PostScenario;
  photosUrl404?: boolean;
}): () => void {
  const pollScenario = opts.poll ?? 'nominal';
  const postScenario = opts.post ?? 'success';
  const tourScenario = opts.tour ?? 'nominal';

  _setMts1Handlers({
    pollOrders: async () => POLL_SCENARIOS[pollScenario](),
    getTour: async (_tourId: string) => TOUR_SCENARIOS[tourScenario](),
    postOrder: async (_payload: Record<string, unknown>) =>
      POST_SCENARIOS[postScenario](),
    getPhotos: opts.photosUrl404
      ? async (_tourId: string) => {
          const f = loadFixture<{ photos: Mts1Photo[] }>('pesees_photos.json');
          return f.photos.map((p) => ({
            ...p,
            url: 'https://mts1-storage.example.com/photos/not-found-404.jpg',
          }));
        }
      : async (_tourId: string) => {
          const f = loadFixture<{ photos: Mts1Photo[] }>('pesees_photos.json');
          return f.photos;
        },
  });

  return () => _setMts1Handlers(null);
}

/**
 * Retourne les libellés flux attendus by l'adapter (as-built MTS-1).
 * Utilisé pour valider le mapping dans les tests adapter (M1.5).
 */
export function getMts1FluxLibelles(): Record<string, string> {
  const f = loadFixture<{ _mapping_libelles: Record<string, string> }>(
    'tours_pesees_flux.json',
  );
  return f._mapping_libelles;
}
