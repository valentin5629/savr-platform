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

// A7 : enums officiels customerOrderStatus MTS-1 (as-built §7). L'ancien jeu
// (PENDING/ACCEPTED/IN_PROGRESS/DELIVERED) ne correspondait pas au contrat réel.
export type Mts1OrderStatus =
  | 'QUOTE'
  | 'DRAFT'
  | 'PLANNED'
  | 'VALIDATED'
  | 'IN_PROGRESSION'
  | 'OK'
  | 'PARTIAL'
  | 'ARCHIVED'
  | 'CANCELED'
  | 'KO';

// Commande telle que la rend GET /v3/customerOrders — mesuré sur le compte de
// démonstration le 2026-10-13. La réponse est un TABLEAU JSON NU de ces objets,
// sans enveloppe ni pagination. Sont typés les champs que lit l'adapter, plus
// `orderDate` (non lu) ; l'API en rend d'autres (`place`, `stuffs`, `contact`,
// `currentTours`, …).
//   - `customerOrderId` : identifiant technique, celui que garde
//     `tournees.external_ref_commande` ;
//   - `orderNumber` : la clé « {collecte}-{rang} » posée à la création. Elle
//     n'est PAS unique chez MTS-1 (jusqu'à 25 commandes mesurées sous un même
//     numéro) ;
//   - `orderDate` : instant UTC du créneau (« 2026-10-16T09:30:00.000Z »).
// Ni `id`, ni `externalReference`, ni `status` n'existent sur le fil.
export interface Mts1CustomerOrder {
  customerOrderId: string;
  orderNumber: string;
  customerOrderStatus: Mts1OrderStatus;
  orderDate?: string;
  // Tournée à laquelle la commande est rattachée : `{ tourId, stopId, tourDate,
  // scheduleId }`. Sans `tourId` tant qu'elle ne l'est à aucune. `currentTours`
  // porte le même élément (mesuré le 2026-10-13 sur le compte de démonstration).
  currentTour?: { tourId?: string } | null;
}

// Détail d'un tour tel que le rend GET /v3/tours/{tourId} — mesuré sur le compte
// de démonstration le 2026-10-13. Sont typés les champs que lisent l'adapter, les
// tests et les fixtures ; l'API en rend d'autres (`summary`, `signatures`,
// `stopStatus`, `place`, `contact`, …). Aucun arrêt ne porte de clé `items` ni
// `weight`, aucun stuff de clé `weight` : la forme lue jusque-là n'existait pas.

// Marchandise d'un arrêt. `quantityAfterPickup` et `quantityAfterDelivery` valent
// `null` tant que le chauffeur n'a rien saisi ; sur le seul tour de déchets
// terminé du compte, ce sont eux qui portent les kilos, alors que
// `quantity` vaut 0 et `measurement.weight` 0.
export interface Mts1StopStuff {
  name: string;
  task?: string;
  quantity?: number | null;
  quantityAfterPickup?: number | null;
  quantityAfterDelivery?: number | null;
  measurement?: { weight?: number | null };
}

// Commande que sert un arrêt. `customerOrderProgressionStatus` (`NOT_STARTED`,
// `FINISHED` mesurés) n'existe que là : ni la liste ni le détail des commandes
// ne le portent.
export interface Mts1StopCustomerOrder {
  customerOrderId: string;
  orderNumber?: string;
  customerOrderStatus?: string;
  customerOrderProgressionStatus?: string;
}

// Photo d'un arrêt : une adresse et rien d'autre (ni identifiant, ni date, ni
// type). Elle a la forme `<connecteur>/v3/tours/photo/{tourId}/{stopId}/{photoId}`
// et ne se lit qu'avec la clé d'API (401 sans).
export interface Mts1StopPhoto {
  downloadUrl: string;
}

// `stopType` : `CUSTOMER_ORDER` = enlèvement chez le client ; `CUSTOMER_ORDER_LINKED`
// ou `DEPOT` = dépôt. Les stuffs d'une commande sont répétés sur son enlèvement
// ET sur son dépôt.
export interface Mts1TourStop {
  stopId: string;
  stopType?: string;
  customerOrders?: Mts1StopCustomerOrder[];
  stuffs?: Mts1StopStuff[];
  photos?: Mts1StopPhoto[];
}

// Bloc dispatch du tour (as-built §7) — porte les codes opaques résolus en
// plaque/chauffeur via GET /v3/carrier (BL-P1-API-03).
export interface Mts1TourDispatch {
  carrierShareableCode?: string;
  transporterUserShareableCode?: string | null;
  vehicleShareableCode?: string | null;
}

// `status` est un OBJET, pas un libellé (valeurs mesurées : `dispatch` ∈
// TO_BE_DISPATCHED / PROPOSED / ACCEPTED / COMPLETED, `progression` ∈ NOT_STARTED /
// FINISHED).
export interface Mts1TourStatus {
  dispatch?: string;
  validation?: string;
  progression?: string;
  payment?: string;
  dispatchedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface Mts1Tour {
  // `tourId` et `stops` sont absents quand l'identifiant est inconnu de MTS-1, qui
  // répond alors 200 avec `{ status, summary }` ; un tour sans commande porte
  // `stops: []` (mesuré le 2026-10-13).
  tourId?: string;
  tourNumber?: string;
  tourDate?: string;
  status?: Mts1TourStatus;
  stops?: Mts1TourStop[];
  dispatch?: Mts1TourDispatch;
}

// Référentiel transporteurs MTS-1 (GET /v3/carrier) — quasi statique (as-built §6).
// La plaque/chauffeur ne sont PAS sur le tour : on les résout ici par code.
export interface Mts1CarrierVehicle {
  name?: string;
  numberPlate: string;
  vehicleShareableCode: string;
}

export interface Mts1CarrierTransporter {
  firstname: string;
  lastname: string;
  transporterShareableCode: string;
  // Téléphone du chauffeur : NON exposé par l'API MTS-1 aujourd'hui (as-built §6,
  // « transporters[] ne porte ni téléphone ni email »). Champ OPTIONNEL réservé —
  // capté automatiquement SI l'API l'expose un jour ; sinon renseigné manuellement
  // par l'Admin (fiche collecte). Ne jamais présumer sa présence.
  phone?: string;
}

export interface Mts1Carrier {
  carrierShareableCode: string;
  name?: string;
  vehicles: Mts1CarrierVehicle[];
  transporters: Mts1CarrierTransporter[];
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

export interface Mts1Handlers {
  // M1.5b — entrant. Rend le tableau nu, comme le fil.
  pollOrders: () => Promise<Mts1CustomerOrder[]>;
  getTour: (tourId: string) => Promise<Mts1Tour>;
  // Téléchargement d'une photo par son adresse (lue dans le détail du tour).
  // `null` = photo absente. Sans ce handler, le client rend un JPEG simulé.
  downloadPhoto?: (downloadUrl: string) => Promise<Buffer | null>;
  // M1.5b — référentiel transporteurs (résolution plaque/chauffeur, BL-P1-API-03)
  getCarrier?: () => Promise<Mts1Carrier[]>;
  // M1.5a — sortant
  // La commande seule : les tournées, l'Admin les compose dans la console MTS-1
  // (décision Val 2026-10-15).
  postOrder: (payload: Record<string, unknown>) => Promise<Mts1PostResult>;
  updateOrder?: (
    orderId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  deleteOrder?: (orderId: string) => Promise<void>;
  // Recherche par fenêtre de jours (« yyyy-MM-dd »), filtrée par numéro de
  // commande quand il est donné.
  scanOrdersByDateRange?: (
    minDate: string,
    maxDate: string,
    orderNumber?: string,
  ) => Promise<Mts1CustomerOrder[]>;
  // Recherche par identifiants : un identifiant inconnu est absent du tableau.
  findOrdersByIds?: (
    customerOrderIds: string[],
  ) => Promise<Mts1CustomerOrder[]>;
}

/** Un JPEG minimal (il commence par FF D8 FF et finit par FF D9). */
export const JPEG_SIMULE = Buffer.from('ffd8ffe000104a464946ffd9', 'hex');

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
  payload_a?: { event_id: string };
  payload_b?: { event_id: string };
}

interface MultiCamionsFixture {
  customerOrders: Mts1CustomerOrder[];
  tours: Mts1Tour[];
}

const POLL_SCENARIOS: Record<Mts1PollScenario, () => Mts1CustomerOrder[]> = {
  nominal: () =>
    loadFixture<{ response: Mts1CustomerOrder[] }>('poll_statuts_nominal.json')
      .response,
  dedup: () => {
    const f = loadFixture<PollFixture>('poll_dedup_pair.json');
    return [
      {
        customerOrderId: 'MTS1-DEDUP-001',
        orderNumber: f.payload_a?.event_id ?? 'dedup-ref',
        customerOrderStatus: 'OK',
      },
    ];
  },
  multi_camions: () =>
    loadFixture<MultiCamionsFixture>('tours_multi_camions.json').customerOrders,
  ko_partiel: () =>
    loadFixture<{ customerOrders: Mts1CustomerOrder[] }>(
      'tours_ko_partiel.json',
    ).customerOrders,
  pesees_incompletes: () => {
    const f = loadFixture<{ tour: Mts1Tour }>('tours_pesees_incompletes.json');
    const commande = f.tour.stops?.[0]?.customerOrders?.[0];
    if (!commande) throw new Error('fixture manquante: commande du tour');
    return [
      {
        customerOrderId: commande.customerOrderId,
        orderNumber: commande.orderNumber ?? '',
        customerOrderStatus: 'OK',
        currentTour: { tourId: f.tour.tourId },
      },
    ];
  },
};

export type Mts1TourScenario =
  | 'nominal'
  | 'stuff_inconnu'
  | 'multi_camions_tour1'
  | 'multi_camions_tour2'
  | 'pesees_incompletes'
  | 'photos';

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
  photos: () => {
    const f = loadFixture<{ tour: Mts1Tour }>('pesees_photos.json');
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
    response: Mts1CustomerOrder[];
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
    const order = f.plan_b_scan.response[0];
    if (!order) throw new Error('fixture manquante: plan_b_scan.response[0]');
    return {
      ok: true,
      id: order.customerOrderId,
      externalReference: order.orderNumber,
      status: order.customerOrderStatus,
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
  photoAbsente?: boolean;
}): () => void {
  const pollScenario = opts.poll ?? 'nominal';
  const postScenario = opts.post ?? 'success';
  const tourScenario = opts.tour ?? 'nominal';

  _setMts1Handlers({
    pollOrders: async () => POLL_SCENARIOS[pollScenario](),
    getTour: async (_tourId: string) => TOUR_SCENARIOS[tourScenario](),
    postOrder: async (_payload: Record<string, unknown>) =>
      POST_SCENARIOS[postScenario](),
    ...(opts.photoAbsente
      ? { downloadPhoto: async (_downloadUrl: string) => null }
      : {}),
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
