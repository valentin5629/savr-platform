// Client HTTP MTS-1 — sortant uniquement (M1.5a).
// Polling entrant (GET /v3/customerOrders, GET /v3/tours) = M1.5b.
//
// Injection mock via _getMts1Handlers() en CI — jamais l'API réelle.
// Auth : Bearer token depuis MTS1_API_KEY (env var alimentée depuis Vault).
// Logs : integrations_logs (via callback pour éviter dépendance circulaire).

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import type { Mts1CustomerOrder } from './mock.js';
import { _getMts1Handlers } from './mock.js';

export interface CreateOrderPayload {
  orderNumber: string;
  orderDate: string;
  timezone: string;
  serviceTime: number;
  transportersNeededCount: number;
  orderCategories: string[];
  place: { address: { addressSingleLine: string } };
  timeslots: Array<{ start: string; end: string }>;
  contacts: Array<{ name: string; phone: string; role: string }>;
  stuffs?: Array<{ name: string; task: string; quantity: number }>;
}

export interface CreateTourPayload {
  customerOrderId: string;
  orderNumber: string;
  deliveryPlace?: { address: { addressSingleLine: string } };
  stuffs?: Array<{ name: string; task: string; quantity: number }>;
}

export interface CreatedOrder {
  id: string;
  externalReference: string;
  status: string;
  createdAt: string;
}

export interface CreatedTour {
  tourId: string;
  externalReference: string;
  status: string;
  createdAt: string;
  customerOrderId: string;
}

export type ScanResult = Mts1CustomerOrder[];

export class Mts1Client {
  private readonly baseUrl: string;
  private readonly apiKey: string;

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
        id: result.id,
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
    return (await res.json()) as CreatedOrder;
  }

  async createTour(payload: CreateTourPayload): Promise<CreatedTour> {
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.createTour) {
      const result = await handlers.createTour(
        payload as unknown as Record<string, unknown>,
      );
      await this.log({
        methode: 'POST',
        endpoint: '/v3/tours',
        statut_http: 201,
        duree_ms: Date.now() - t0,
        correlation_id: payload.orderNumber,
      });
      return result;
    }

    const res = await this.fetch(
      'POST',
      '/v3/tours',
      payload,
      payload.orderNumber,
      t0,
    );
    return (await res.json()) as CreatedTour;
  }

  async dispatchTour(
    tourId: string,
    carrierShareableCode: string,
    correlationId?: string,
  ): Promise<void> {
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.dispatchTour) {
      await handlers.dispatchTour(tourId, carrierShareableCode);
      await this.log({
        methode: 'POST',
        endpoint: `/v3/tours/${tourId}/dispatch`,
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: correlationId,
      });
      return;
    }

    await this.fetch(
      'POST',
      `/v3/tours/${tourId}/dispatch`,
      { carrierShareableCode },
      correlationId,
      t0,
    );
  }

  async validateTour(tourId: string, correlationId?: string): Promise<void> {
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.validateTour) {
      await handlers.validateTour(tourId);
      await this.log({
        methode: 'PUT',
        endpoint: `/v3/tours/${tourId}/validate`,
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: correlationId,
      });
      return;
    }

    await this.fetch(
      'PUT',
      `/v3/tours/${tourId}/validate`,
      {},
      correlationId,
      t0,
    );
  }

  async updateOrder(
    orderId: string,
    payload: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.updateOrder) {
      await handlers.updateOrder(orderId, payload);
      await this.log({
        methode: 'PUT',
        endpoint: `/v3/customerOrders/${orderId}`,
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: correlationId,
      });
      return;
    }

    await this.fetch(
      'PUT',
      `/v3/customerOrders/${orderId}`,
      payload,
      correlationId,
      t0,
    );
  }

  async deleteOrder(orderId: string, correlationId?: string): Promise<void> {
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.deleteOrder) {
      await handlers.deleteOrder(orderId);
      await this.log({
        methode: 'DELETE',
        endpoint: `/v3/customerOrders/${orderId}`,
        statut_http: 200,
        duree_ms: Date.now() - t0,
        correlation_id: correlationId,
      });
      return;
    }

    await this.fetch(
      'DELETE',
      `/v3/customerOrders/${orderId}`,
      undefined,
      correlationId,
      t0,
    );
  }

  async scanOrdersByDateRange(
    minDate: string,
    maxDate: string,
  ): Promise<ScanResult> {
    const handlers = _getMts1Handlers();
    const t0 = Date.now();

    if (handlers?.scanOrdersByDateRange) {
      const result = await handlers.scanOrdersByDateRange(minDate, maxDate);
      await this.log({
        methode: 'GET',
        endpoint: '/v3/customerOrders',
        statut_http: 200,
        duree_ms: Date.now() - t0,
      });
      return result;
    }

    const params = new URLSearchParams({ minDate, maxDate, pageSize: '200' });
    const res = await this.fetch(
      'GET',
      `/v3/customerOrders?${params.toString()}`,
      undefined,
      undefined,
      t0,
    );
    const body = (await res.json()) as { customerOrders: ScanResult };
    return body.customerOrders;
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async fetch(
    method: string,
    path: string,
    body: unknown,
    correlationId: string | undefined,
    t0: number,
  ): Promise<Response> {
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
      await this.log({
        methode: method,
        endpoint: path,
        duree_ms: Date.now() - t0,
        erreur: String(err),
        correlation_id: correlationId,
      });
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LogistiqueAmbiguousError(`MTS-1 timeout : ${method} ${path}`);
      }
      throw new LogistiqueTransientError(`MTS-1 réseau : ${String(err)}`);
    }
    clearTimeout(timeout);

    await this.log({
      methode: method,
      endpoint: path,
      statut_http: res.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
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
    if (status >= 500) {
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
  }): Promise<void> {
    await this.supabase.from('integrations_logs').insert({
      integration: 'mts1',
      direction: 'sortant',
      methode: entry.methode,
      endpoint: entry.endpoint,
      statut_http: entry.statut_http ?? null,
      duree_ms: entry.duree_ms ?? null,
      correlation_id: entry.correlation_id ?? null,
      erreur: entry.erreur ?? null,
    });
  }
}
