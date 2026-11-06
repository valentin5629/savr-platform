import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';

/**
 * Libellé de chaque collecte d'un événement : « Collecte Zéro Déchet #1 »
 * (graphie de l'app, arbitrage D38 du 2026-10-07),
 * « Collecte Anti-Gaspi #2 »… (refonte du formulaire, lot B2 ; §06.01 étape 3
 * et page de confirmation). Numérotées par type, dans l'ordre de date, d'heure,
 * puis de création : les collectes annulées gardent leur numéro, pour que les
 * autres ne changent pas de nom après une annulation. Partagé par l'email
 * récapitulatif et la page de confirmation (même libellé des deux côtés).
 */

export interface CollecteANumeroter {
  id: string;
  /** Alias du formulaire (`zd`/`ag`) ou valeur de l'enum (`zero_dechet`/`anti_gaspi`). */
  type: string;
  date_collecte: string | null;
  heure_collecte: string | null;
  created_at?: string | null;
}

export const estZeroDechet = (type: string): boolean =>
  type === 'zd' || type === 'zero_dechet';

const cle = (c: CollecteANumeroter): string =>
  `${c.date_collecte ?? '9999-12-31'}|${c.heure_collecte ?? '99:99'}|${c.created_at ?? ''}|${c.id}`;

/** Collectes triées (Zéro-Déchet puis Anti-Gaspi, puis date, heure, création) et leur libellé. */
export function numeroterCollectes<T extends CollecteANumeroter>(
  collectes: readonly T[],
): { collecte: T; libelle: string }[] {
  const tri = [...collectes].sort((a, b) => {
    const typeA = estZeroDechet(a.type) ? 0 : 1;
    const typeB = estZeroDechet(b.type) ? 0 : 1;
    if (typeA !== typeB) return typeA - typeB;
    return cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0;
  });
  const rangs = { zd: 0, ag: 0 };
  return tri.map((collecte) => {
    const zd = estZeroDechet(collecte.type);
    const rang = zd ? ++rangs.zd : ++rangs.ag;
    return {
      collecte,
      libelle: `Collecte ${libelleTypeCollecte(collecte.type)} #${rang}`,
    };
  });
}
