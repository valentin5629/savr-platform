'use client';

import { useEffect, useState } from 'react';

export interface PackInfo {
  pack_actif: boolean;
  credits_initiaux?: number;
  credits_consommes?: number;
  credits_restants?: number;
}

/** Cible « le pack de l'appelant » (rôles clients). */
export const PACK_PROPRE = 'propre';

/**
 * Pack AG de l'organisation programmatrice, pour l'information « facturée à
 * l'unité » — informative, jamais bloquante (décision Val 2026-10-16).
 *
 * `cible` : `null` = aucune lecture (AG non choisie, ou organisation encore
 * inconnue en programmation de support Admin) ; `PACK_PROPRE` = pack de
 * l'appelant ; sinon l'id de l'organisation ciblée par le staff (seul le staff
 * voit ce paramètre honoré côté route).
 *
 * L'état est remis à zéro à chaque changement de cible : le pack de la cible
 * précédente ne reste jamais affiché pendant la lecture de la suivante, et une
 * réponse arrivée après coup est ignorée.
 */
export function usePackAg(cible: string | null): PackInfo | null {
  const [pack, setPack] = useState<PackInfo | null>(null);

  useEffect(() => {
    setPack(null);
    if (cible === null) return;
    let ignore = false;
    const url =
      cible === PACK_PROPRE
        ? '/api/v1/programmation/pack-ag'
        : `/api/v1/programmation/pack-ag?organisation_id=${encodeURIComponent(cible)}`;
    fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<PackInfo>) : null))
      .then((data) => {
        if (!ignore) setPack(data);
      })
      .catch(() => {
        if (!ignore) setPack(null);
      });
    return () => {
      ignore = true;
    };
  }, [cible]);

  return pack;
}

/** Sans pack actif, ou pack actif sans crédit : la collecte AG est facturée à l'unité. */
export function factureeAlUnite(pack: PackInfo): boolean {
  return !(pack.pack_actif && (pack.credits_restants ?? 0) > 0);
}
