// Détail d'un tour MTS-1 pour les tests, dans la forme que rend
// GET /v3/tours/{tourId} (mesurée sur le compte de démonstration le 2026-10-13).
// La forme est celle du fil ; toutes les valeurs sont inventées.

import type { Mts1StopStuff, Mts1Tour } from './mock.js';
import { JPEG_SIMULE } from './mock.js';

/** Connecteur fictif : l'hôte des adresses de photos simulées. */
export const CONNECTEUR_SIMULE = 'https://mts1.test';

/** Un JPEG minimal, celui que rend aussi le client simulé. */
export const JPEG_DE_TEST = JPEG_SIMULE;

/**
 * Stuff d'un arrêt. `pese` est ce que le chauffeur a saisi à l'enlèvement
 * (`null` : rien) ; `quantity` reste à 0 pour un flux, à 1 pour le camion.
 */
export function stuffSimule(
  name: string,
  pese: number | null,
  quantity = 0,
): Mts1StopStuff {
  return {
    name,
    task: 'PICKUP',
    quantity,
    quantityAfterPickup: pese,
    quantityAfterDelivery: pese,
    measurement: { weight: 0 },
  };
}

/** Adresse d'une photo, dans la forme mesurée. */
export function adressePhotoSimulee(
  tourId: string,
  stopId: string,
  photoId: string,
): string {
  return `${CONNECTEUR_SIMULE}/v3/tours/photo/${tourId}/${stopId}/${photoId}`;
}

/**
 * Tour à une commande : un arrêt d'enlèvement (`CUSTOMER_ORDER`) et un arrêt de
 * dépôt qui RÉPÈTE les mêmes stuffs, comme le fait MTS-1.
 */
export function tourSimule(opts: {
  tourId: string;
  customerOrderId: string;
  stopId: string;
  stuffs: Mts1StopStuff[];
  /** Identifiants des photos de l'arrêt d'enlèvement. */
  photosEnlevement?: string[];
  /** Identifiants des photos de l'arrêt de dépôt. */
  photosDepot?: string[];
  /** Mission terminée : `FINISHED` sur les arrêts et sur le tour. */
  terminee?: boolean;
  typeDepot?: 'CUSTOMER_ORDER_LINKED' | 'DEPOT';
}): Mts1Tour {
  const progression = opts.terminee ? 'FINISHED' : 'NOT_STARTED';
  const customerOrders = [
    {
      customerOrderId: opts.customerOrderId,
      orderNumber: `numero-${opts.customerOrderId}`,
      customerOrderStatus: 'VALIDATED',
      customerOrderProgressionStatus: progression,
    },
  ];
  const stopDepot = `${opts.stopId}-depot`;
  return {
    tourId: opts.tourId,
    tourNumber: `numero-${opts.tourId}`,
    tourDate: '2026-07-15T20:00:00.000Z',
    status: {
      dispatch: opts.terminee ? 'COMPLETED' : 'ACCEPTED',
      validation: 'VALIDATED',
      progression,
      payment: 'VALIDATED',
    },
    stops: [
      {
        stopId: opts.stopId,
        stopType: 'CUSTOMER_ORDER',
        customerOrders,
        stuffs: opts.stuffs,
        photos: (opts.photosEnlevement ?? []).map((photoId) => ({
          downloadUrl: adressePhotoSimulee(opts.tourId, opts.stopId, photoId),
        })),
      },
      {
        stopId: stopDepot,
        stopType: opts.typeDepot ?? 'DEPOT',
        customerOrders,
        stuffs: opts.stuffs,
        photos: (opts.photosDepot ?? []).map((photoId) => ({
          downloadUrl: adressePhotoSimulee(opts.tourId, stopDepot, photoId),
        })),
      },
    ],
  };
}
