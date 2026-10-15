// Client HTTP MTS-1 — sortant uniquement (M1.5a).
// Polling entrant (GET /v3/customerOrders, GET /v3/tours) = M1.5b.
//
// Injection mock via _getMts1Handlers() en CI — jamais l'API réelle.
// Auth : Bearer token depuis MTS1_API_KEY (env var alimentée depuis Vault).
// Logs : integrations_logs (via callback pour éviter dépendance circulaire).

import type { SupabaseClient } from '@supabase/supabase-js';

import { libelleErreurReseau } from '@savr/shared/src/api/erreur-reseau.js';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import { verifierEcheance } from '../echeance-passage.js';
import type { Mts1Carrier, Mts1CustomerOrder, Mts1Tour } from './mock.js';
import { JPEG_SIMULE, _getMts1Handlers } from './mock.js';

// Point de dépôt (B) d'un stuff : favoritePlace MTS-1 ou adresse inline.
export type PointLivraison =
  | { placeId: string }
  | { address: { addressSingleLine: string } };

export interface CreateOrderPayload {
  orderNumber: string;
  orderDate: string;
  timezone: string;
  serviceTime: number;
  transportersNeededCount: number;
  orderCategories: string[];
  // `place` = CustomerOrderPlaceInput. Le créneau (`timeslots`, Timeslot[{start,end}])
  // est porté PAR LE LIEU — il n'existe pas au niveau commande (découvert au read-back
  // sandbox : un `timeslots` top-level était silencieusement ignoré).
  place: {
    address: { addressSingleLine: string };
    timeslots?: Array<{ start: string; end: string }>;
  };
  // Contact terrain = CustomerOrderContactInput, objet UNIQUE (pas un tableau
  // `contacts`) : MTS-1 attend `firstname`/`lastname`/`phone` (+ `phoneAlternatives`),
  // PAS `name`/`role` — sinon le contact arrive vide (`{}`).
  contact?: {
    firstname?: string;
    lastname?: string;
    phone?: string;
    phoneAlternatives?: string[];
  };
  // `relatedAddress` = point de dépôt (B) du stuff : `placeId` d'un favoritePlace
  // (entrepôt Savr pour le ZD / association pour l'AG) OU adresse inline. Le `place`
  // de la commande est le PICKUP (point A).
  stuffs?: Array<{
    name: string;
    task: string;
    quantity: number;
    relatedAddress?: PointLivraison;
  }>;
  // Instructions logistiques libres transmises au prestataire (M01/M03/M05).
  // MTS-1 as-built §3bis.5 l.389 : `comment` ← collectes.informations_supplementaires.
  comment?: string;
}

export interface CreatedOrder {
  id: string;
  externalReference: string;
  status: string;
  createdAt: string;
}

export type ScanResult = Mts1CustomerOrder[];

// Seule écriture de date que lit GET /v3/customerOrders (mesuré 2026-10-13).
const JOUR_SEUL = /^\d{4}-\d{2}-\d{2}$/;

// Identifiant MTS-1 que Savr accepte d'adopter, c'est-à-dire d'écrire dans
// `tournees.external_ref_commande` (et, pour la commande du rang 1, dans
// `collectes.tms_reference`), ou de placer dans un chemin. Mesuré le 2026-10-13 sur
// le compte de démonstration, en lecture seule : 98 identifiants distincts,
// commandes et tournées, tous de 24 caractères hexadécimaux minuscules. La
// règle est plus large que la mesure, le compte de production n'ayant jamais
// été interrogé : lettres, chiffres, tiret et souligné, soit aucun caractère
// qui ait un sens dans un chemin ou dans une requête ; 128 caractères au plus.
const IDENTIFIANT_MTS1 = /^[A-Za-z0-9_-]{1,128}$/;

export function estIdentifiantMts1(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && IDENTIFIANT_MTS1.test(valeur);
}

// Segment de chemin portant un identifiant, qu'il soit lu en base ou rendu par
// MTS-1. Encodé : avec « / », « ? » ou « # », la requête envoyée reste celle de
// la route appelée. Sans effet sur les identifiants mesurés (l'encodage n'en
// modifie aucun) ; ce que le serveur fait d'un segment encodé n'est donc pas
// mesuré. « . » et « .. » en sortent intacts, et `fetch` les résout comme des
// segments relatifs (« /v3/tours/../validate » part vers « /v3/validate ») :
// refusés, comme l'identifiant vide, une valeur qui n'est pas une chaîne, et
// une chaîne que l'encodage refuse (demi-caractère UTF-16 isolé).
const IDENTIFIANT_INUTILISABLE =
  'MTS-1 : identifiant inutilisable dans un chemin (vide, « . », « .. » ou non encodable)';

function segment(identifiant: unknown): string {
  if (
    typeof identifiant !== 'string' ||
    !identifiant ||
    identifiant === '.' ||
    identifiant === '..'
  ) {
    throw new LogistiquePermanentError(IDENTIFIANT_INUTILISABLE);
  }
  try {
    return encodeURIComponent(identifiant);
  } catch {
    throw new LogistiquePermanentError(IDENTIFIANT_INUTILISABLE);
  }
}

// Plafond du corps d'une photo. MTS-1 n'en annonce pas la taille (aucun
// Content-Length sur les 7 photos mesurées le 2026-10-13, 131 à 231 Ko de base64).
const PLAFOND_CORPS_PHOTO = 15 * 1024 * 1024;

// Corps lu morceau par morceau, arrêté au plafond. Une lecture interrompue par
// l'échéance (signal) lève une erreur ambiguë, comme une réponse qui n'arrive pas.
async function lireCorpsPlafonne(
  res: Response,
  signal: AbortSignal,
): Promise<Buffer> {
  try {
    if (!res.body) return Buffer.alloc(0);
    const lecteur = res.body.getReader();
    const morceaux: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) return Buffer.concat(morceaux);
      total += value.byteLength;
      if (total > PLAFOND_CORPS_PHOTO) {
        await lecteur.cancel();
        throw new LogistiqueTransientError(
          'MTS-1 : photo de plus de 15 Mo, non téléchargée',
        );
      }
      morceaux.push(Buffer.from(value));
    }
  } catch (err) {
    if (signal.aborted) {
      throw new LogistiqueAmbiguousError('MTS-1 timeout : photo');
    }
    throw err;
  }
}

// Un fichier JPEG commence par les octets FF D8 FF.
function estJpeg(octets: Buffer): boolean {
  return (
    octets.length > 3 &&
    octets[0] === 0xff &&
    octets[1] === 0xd8 &&
    octets[2] === 0xff
  );
}

export class Mts1Client {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  // Cache instance du référentiel transporteurs (quasi statique, as-built §6) :
  // un seul GET /v3/carrier par run de sync, partagé entre les N tours traités.
  private carrierCache: Mts1Carrier[] | null = null;

  constructor(private readonly supabase: SupabaseClient) {
    this.baseUrl = process.env['MTS1_BASE_URL'] ?? '';
    this.apiKey = process.env['MTS1_API_KEY'] ?? '';
  }

  async postOrder(payload: CreateOrderPayload): Promise<CreatedOrder> {
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers) {
      const result = await handlers.postOrder(
        payload as unknown as Record<string, unknown>,
      );
      if (!result.ok) {
        await this.log({
          methode: 'POST',
          endpoint: '/v3/customerOrders',
          statut_http: result.status,
          duree_ms: Date.now() - t0,
          correlation_id: payload.orderNumber,
          erreur: result.error,
        });
        throw this.httpError(result.status, result.message);
      }
      await this.log({
        methode: 'POST',
        endpoint: '/v3/customerOrders',
        statut_http: 201,
        duree_ms: Date.now() - t0,
        correlation_id: payload.orderNumber,
      });
      return {
        id: this.identifiantCree(result, 'id', 'POST /v3/customerOrders'),
        externalReference: result.externalReference,
        status: result.status,
        createdAt: result.createdAt,
      };
    }

    const res = await this.fetch(
      'POST',
      '/v3/customerOrders',
      payload,
      payload.orderNumber,
      t0,
    );
    // La réponse V3 (`CreateCustomerOrderResponse`) nomme l'id technique
    // `customerOrderId`, PAS `id` → mapper explicitement. Sinon `created.id` est
    // `undefined` et `external_ref_commande` n'est jamais enregistré.
    const body = (await res.json().catch(() => null)) as {
      customerOrderId?: string;
      orderNumber?: string;
      customerOrderStatus?: string;
    } | null;
    return {
      id: this.identifiantCree(
        body,
        'customerOrderId',
        'POST /v3/customerOrders',
      ),
      externalReference: body?.orderNumber ?? '',
      status: body?.customerOrderStatus ?? '',
      createdAt: '',
    };
  }

  async updateOrder(
    orderId: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const chemin = `/v3/customerOrders/${segment(orderId)}`;
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.updateOrder) {
      await handlers.updateOrder(orderId, payload);
      await this.log({
        methode: 'PUT',
        endpoint: chemin,
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: correlationId,
      });
      return;
    }

    await this.fetch('PUT', chemin, payload, correlationId, t0);
  }

  async deleteOrder(orderId: string, correlationId?: string): Promise<void> {
    const chemin = `/v3/customerOrders/${segment(orderId)}`;
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.deleteOrder) {
      await handlers.deleteOrder(orderId);
      await this.log({
        methode: 'DELETE',
        endpoint: chemin,
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: correlationId,
      });
      return;
    }

    await this.fetch('DELETE', chemin, undefined, correlationId, t0);
  }

  /**
   * Recherche de commandes par fenêtre de JOURS — GET /v3/customerOrders.
   *
   * Contrat mesuré sur le compte de démonstration (2026-10-13, lecture seule) :
   *   - `minDate` / `maxDate` ne se lisent qu'en « yyyy-MM-dd ». Un instant (ISO
   *     avec ou sans millisecondes, avec ou sans fuseau) répond
   *     500 INTERNAL_ERROR, des bornes inversées aussi ;
   *   - les deux bornes sont INCLUSES et le jour est compté à Paris, pas en UTC
   *     (une commande à 22h01 UTC le 9 sort pour le 10, pas pour le 9) ;
   *   - `orderNumber` filtre à l'égalité stricte, casse comprise, et ne dispense
   *     pas des dates (seul, il répond 400) ;
   *   - la réponse est un tableau JSON nu, sans ordre garanti et sans
   *     pagination (`pageSize`, `page`, `limit` sont ignorés). Aucun plafond n'a
   *     pu être mesuré au-delà des 72 commandes du compte : garder la fenêtre
   *     étroite.
   */
  async scanOrdersByDateRange(
    minDate: string,
    maxDate: string,
    orderNumber?: string,
  ): Promise<ScanResult> {
    // Refus AVANT tout appel, mock compris : un instant ferait répondre 500 à
    // MTS-1, soit une erreur passagère, rejouée jusqu'à la quatrième tentative
    // sans jamais aboutir.
    if (
      !JOUR_SEUL.test(minDate) ||
      !JOUR_SEUL.test(maxDate) ||
      minDate > maxDate
    ) {
      throw new LogistiquePermanentError(
        `MTS-1 : fenêtre de recherche invalide (« ${minDate} » → « ${maxDate} »), deux jours yyyy-MM-dd attendus, dans l'ordre`,
      );
    }

    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.scanOrdersByDateRange) {
      const result = await handlers.scanOrdersByDateRange(
        minDate,
        maxDate,
        orderNumber,
      );
      await this.log({
        methode: 'GET',
        endpoint: '/v3/customerOrders',
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: orderNumber,
      });
      return result;
    }

    // Fallback mock : pollOrders si pas de scanOrdersByDateRange (rétro-compat tests)
    if (handlers?.pollOrders) {
      const result = await handlers.pollOrders();
      await this.log({
        methode: 'GET',
        endpoint: '/v3/customerOrders',
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: orderNumber,
      });
      return result;
    }

    const params = new URLSearchParams({ minDate, maxDate });
    if (orderNumber) params.set('orderNumber', orderNumber);
    const res = await this.fetch(
      'GET',
      `/v3/customerOrders?${params.toString()}`,
      undefined,
      orderNumber,
      t0,
    );
    return this.lireCommandes(res);
  }

  /**
   * Commandes par identifiant — GET /v3/customerOrders?customerOrderIds=a,b.
   *
   * C'est CETTE lecture qui dit si une commande existe encore (mesuré
   * 2026-10-13) : un identifiant inconnu est simplement absent du tableau rendu
   * (200, jamais 404), quelle que soit la date de la commande. Le détail
   * GET /v3/customerOrders/{id} ne le dit pas : sur un identifiant inconnu il
   * répond 200 avec un objet creux.
   */
  async findOrdersByIds(customerOrderIds: string[]): Promise<ScanResult> {
    if (customerOrderIds.length === 0) return [];

    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.findOrdersByIds) {
      const result = await handlers.findOrdersByIds(customerOrderIds);
      await this.log({
        methode: 'GET',
        endpoint: '/v3/customerOrders',
        statut_http: 200,
        duree_ms: Date.now() - t0,
      });
      return result;
    }

    const params = new URLSearchParams({
      customerOrderIds: customerOrderIds.join(','),
    });
    const res = await this.fetch(
      'GET',
      `/v3/customerOrders?${params.toString()}`,
      undefined,
      undefined,
      t0,
    );
    return this.lireCommandes(res);
  }

  async getTour(tourId: string): Promise<Mts1Tour> {
    const chemin = `/v3/tours/${segment(tourId)}`;
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.getTour) {
      const result = await handlers.getTour(tourId);
      await this.log({
        methode: 'GET',
        endpoint: chemin,
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: tourId,
        direction: 'entrant',
      });
      return result;
    }

    const res = await this.fetch(
      'GET',
      chemin,
      undefined,
      tourId,
      t0,
      'entrant',
    );
    return (await res.json()) as Mts1Tour;
  }

  // BL-P1-API-03 — référentiel transporteurs. La plaque (`numberPlate`) et le
  // chauffeur ne sont PAS sur le tour : ils se résolvent ici par code opaque
  // (`vehicleShareableCode` / `transporterUserShareableCode` du dispatch).
  async getCarrier(): Promise<Mts1Carrier[]> {
    if (this.carrierCache) return this.carrierCache;

    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.getCarrier) {
      const result = await handlers.getCarrier();
      await this.log({
        methode: 'GET',
        endpoint: '/v3/carrier',
        statut_http: 200,
        duree_ms: Date.now() - t0,
        direction: 'entrant',
      });
      this.carrierCache = result;
      return result;
    }

    const res = await this.fetch(
      'GET',
      '/v3/carrier',
      undefined,
      undefined,
      t0,
      'entrant',
    );
    // Tableau nu, comme les commandes (mesuré 2026-10-13) — pas `{ carriers }`.
    const carriers = (await this.lireTableau(
      res,
      'GET /v3/carrier',
    )) as Mts1Carrier[];
    this.carrierCache = carriers;
    return carriers;
  }

  /**
   * Sonde de connectivité read-only (health check ops, hors cron/dispatch).
   * Un seul GET /v3/carrier authentifié, timeout court (5 s). Ne lève JAMAIS :
   * toute erreur (config vide, 401, réseau, timeout) est renvoyée dans le résultat.
   * En mock CI (handlers injectés), renvoie un succès simulé sans appel réseau.
   */
  async ping(): Promise<{
    ok: boolean;
    statutHttp: number | null;
    dureeMs: number;
    erreur?: string;
  }> {
    const t0 = Date.now();

    // Mock CI : jamais d'appel réel.
    if (_getMts1Handlers()) {
      return { ok: true, statutHttp: 200, dureeMs: Date.now() - t0 };
    }

    // Cause n°1 d'échec silencieux : secrets non renseignés. Les noms lus par
    // le code sont MTS1_BASE_URL + MTS1_API_KEY (cf. .env) — on le signale.
    if (!this.baseUrl || !this.apiKey) {
      const manquants = [
        this.baseUrl ? null : 'MTS1_BASE_URL',
        this.apiKey ? null : 'MTS1_API_KEY',
      ].filter(Boolean);
      return {
        ok: false,
        statutHttp: null,
        dureeMs: 0,
        erreur: `Configuration manquante : ${manquants.join(' + ')} vide(s).`,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await globalThis.fetch(`${this.baseUrl}/v3/carrier`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const dureeMs = Date.now() - t0;
      await this.log({
        methode: 'GET',
        endpoint: '/v3/carrier',
        statut_http: res.status,
        duree_ms: dureeMs,
        correlation_id: 'health-check',
        erreur: res.ok ? undefined : `health-check HTTP ${res.status}`,
        direction: 'entrant',
      }).catch(() => undefined);
      return res.ok
        ? { ok: true, statutHttp: res.status, dureeMs }
        : {
            ok: false,
            statutHttp: res.status,
            dureeMs,
            erreur: `HTTP ${res.status}`,
          };
    } catch (err) {
      clearTimeout(timeout);
      const dureeMs = Date.now() - t0;
      const erreur =
        err instanceof Error && err.name === 'AbortError'
          ? 'Timeout (5 s)'
          : `Réseau : ${libelleErreurReseau(err)}`;
      await this.log({
        methode: 'GET',
        endpoint: '/v3/carrier',
        duree_ms: dureeMs,
        correlation_id: 'health-check',
        erreur,
        direction: 'entrant',
      }).catch(() => undefined);
      return { ok: false, statutHttp: null, dureeMs, erreur };
    }
  }

  /**
   * Photo d'un arrêt — GET sur l'adresse `downloadUrl` lue dans le détail du tour
   * (`<connecteur>/v3/tours/photo/{tourId}/{stopId}/{photoId}`).
   *
   * Mesuré sur le compte de démonstration le 2026-10-13, sur ses 7 photos :
   *   - sans clé d'API, 401 `BAD_CREDENTIALS` ; avec, 200 sans redirection ;
   *   - le corps n'est pas le fichier : c'est le JPEG écrit en base64, sans
   *     préfixe ni saut de ligne, annoncé « text/html » ;
   *   - un identifiant de photo inventé répond 200 avec un corps vide, pas 404.
   *
   * Rend `null` pour une photo absente (corps vide, ou 404 par précaution) :
   * l'appelant la retente au passage suivant. Lève si le corps n'est pas un
   * JPEG : rien d'illisible n'est stocké.
   */
  async downloadPhoto(downloadUrl: string): Promise<Buffer | null> {
    const handlers = _getMts1Handlers();
    if (handlers) {
      return handlers.downloadPhoto
        ? handlers.downloadPhoto(downloadUrl)
        : JPEG_SIMULE;
    }

    // La clé d'API ne part que vers le connecteur. L'adresse vient d'une réponse :
    // d'un autre hôte, elle livrerait la clé à un tiers. Une redirection est
    // refusée pour la même raison (aucune n'a été mesurée).
    if (!this.estAdresseDuConnecteur(downloadUrl)) {
      throw new LogistiquePermanentError(
        'MTS-1 : adresse de photo hors du connecteur, non téléchargée',
      );
    }

    // Une seule échéance de 30 s pour la réponse ET son corps : levée plus tôt, un
    // corps qui traîne retenait le passage au-delà, sous `maxDuration = 60`.
    const t0 = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      let res: Response;
      try {
        res = await globalThis.fetch(downloadUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new LogistiqueAmbiguousError('MTS-1 timeout : photo');
        }
        // Jamais le texte de l'erreur : `fetch` y recopie la valeur d'en-tête
        // qu'il refuse, donc la clé entière (cf. libelleErreurReseau).
        throw new LogistiqueTransientError(
          `MTS-1 réseau (photo) : ${libelleErreurReseau(err)}`,
        );
      }

      await this.log({
        methode: 'GET',
        endpoint: '/v3/tours/photo',
        statut_http: res.status,
        duree_ms: Date.now() - t0,
        direction: 'entrant',
      });

      if (res.status === 404) return null;
      if (!res.ok) throw this.httpError(res.status, 'photo');

      const corps = await lireCorpsPlafonne(res, controller.signal);
      if (corps.length === 0) return null;
      // Forme mesurée : le JPEG en base64. Un JPEG déjà binaire est pris tel quel
      // (non mesuré) ; c'est le contenu qui est vérifié, pas l'en-tête de type.
      if (estJpeg(corps)) return corps;
      const decode = Buffer.from(corps.toString('latin1'), 'base64');
      if (estJpeg(decode)) return decode;
      throw new LogistiqueTransientError(
        'MTS-1 : photo illisible (ni JPEG, ni JPEG écrit en base64)',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private estAdresseDuConnecteur(adresse: string): boolean {
    try {
      return new URL(adresse).origin === new URL(this.baseUrl).origin;
    } catch {
      return false;
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  // Identifiant rendu par une CRÉATION (201). À ce stade l'objet existe chez
  // MTS-1, que sa réponse soit lisible ou non : un identifiant illisible n'est
  // ni un refus ni une erreur passagère (un simple rejeu créerait un second
  // objet, l'API étant présumée non idempotente — CLAUDE.md §2). Erreur AMBIGUË :
  // la reprise passe par la réconciliation avant tout re-POST. Illisible : absent,
  // pas une chaîne, ou hors de l'alphabet adopté (cf. IDENTIFIANT_MTS1).
  private identifiantCree(
    corps: unknown,
    champ: string,
    route: string,
  ): string {
    const valeur = (corps as Record<string, unknown> | null | undefined)?.[
      champ
    ];
    if (!estIdentifiantMts1(valeur)) {
      throw new LogistiqueAmbiguousError(
        `MTS-1 ${route} : création acceptée, mais « ${champ} » est illisible dans la réponse`,
      );
    }
    return valeur;
  }

  // Les deux listes lues ici (/v3/customerOrders, /v3/carrier) sont des tableaux
  // JSON nus (mesuré le 2026-10-13). Toute autre forme est REFUSÉE par une
  // erreur passagère (rejouée, puis signalée) : la lire comme
  // une liste vide ferait conclure « commande absente », donc re-POSTer un
  // doublon sur une API présumée non idempotente (CLAUDE.md §2).
  private async lireTableau(res: Response, route: string): Promise<unknown[]> {
    const body: unknown = await res.json().catch(() => undefined);
    if (!Array.isArray(body)) {
      throw new LogistiqueTransientError(
        `MTS-1 ${route} : réponse inattendue, tableau attendu`,
      );
    }
    return body;
  }

  // Une commande sans `customerOrderId` n'est pas lisible : l'identifiant est ce
  // que la relève rapproche d'une tournée et ce que la réconciliation adopte.
  // Une seule suffit à refuser toute la réponse : le contrat a changé.
  // (L'ancien code lisait `id`, qui n'existe pas, sans que rien ne le signale.)
  private async lireCommandes(res: Response): Promise<ScanResult> {
    const commandes = (await this.lireTableau(
      res,
      'GET /v3/customerOrders',
    )) as Array<Partial<Mts1CustomerOrder> | null>;
    if (
      commandes.some(
        (c) => typeof c?.customerOrderId !== 'string' || !c.customerOrderId,
      )
    ) {
      throw new LogistiqueTransientError(
        'MTS-1 GET /v3/customerOrders : réponse inattendue, commande sans customerOrderId',
      );
    }
    return commandes as ScanResult;
  }

  private async fetch(
    method: string,
    path: string,
    body: unknown,
    correlationId: string | undefined,
    t0: number,
    direction: 'sortant' | 'entrant' = 'sortant',
  ): Promise<Response> {
    // Passage du worker : plus aucun appel ne démarre après l'échéance de l'ordre.
    verifierEcheance(`MTS-1 ${method} ${path}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      res = await globalThis.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      // Jamais le texte de l'erreur : `fetch` y recopie la valeur d'en-tête qu'il
      // refuse, donc la clé entière (cf. libelleErreurReseau). Ce libellé va dans
      // integrations_logs, puis outbox_events.last_error, l'alerte et la fiche.
      const libelle = libelleErreurReseau(err);
      await this.log({
        methode: method,
        endpoint: path,
        duree_ms: Date.now() - t0,
        erreur: libelle,
        correlation_id: correlationId,
        direction,
      });
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LogistiqueAmbiguousError(`MTS-1 timeout : ${method} ${path}`);
      }
      throw new LogistiqueTransientError(`MTS-1 réseau : ${libelle}`);
    }
    clearTimeout(timeout);

    await this.log({
      methode: method,
      endpoint: path,
      statut_http: res.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
      direction,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw this.httpError(res.status, txt);
    }

    return res;
  }

  private httpError(status: number, message: string): Error {
    if (status === 408 || status === 504) {
      return new LogistiqueAmbiguousError(`MTS-1 ${status} : ${message}`);
    }
    // 429 rate-limit → transitoire : retenté par les paliers de l'outbox worker
    // (5 min/1 h/24 h), jamais DLQ direct (VOLET 3 R22g, défensif — honore le 429 via
    // le back-off palier, quotas éditeur inconnus §08 l.512 Q3bis-4).
    if (status === 429 || status >= 500) {
      return new LogistiqueTransientError(`MTS-1 ${status} : ${message}`);
    }
    return new LogistiquePermanentError(`MTS-1 ${status} : ${message}`);
  }

  private async log(entry: {
    methode: string;
    endpoint: string;
    statut_http?: number;
    duree_ms?: number;
    correlation_id?: string;
    erreur?: string;
    direction?: 'sortant' | 'entrant';
  }): Promise<void> {
    await this.supabase.from('integrations_logs').insert({
      integration: 'mts1',
      direction: entry.direction ?? 'sortant',
      methode: entry.methode,
      endpoint: entry.endpoint,
      statut_http: entry.statut_http ?? null,
      duree_ms: entry.duree_ms ?? null,
      correlation_id: entry.correlation_id ?? null,
      erreur: entry.erreur ?? null,
    });
  }
}
