'use client';

import type { KeyboardEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TonnageDisplay } from './TonnageDisplay.js';
import type { CollecteType } from './CollecteTypeTabs.js';
import type { TopLieu } from './blocs-types.js';

interface Props {
  items: TopLieu[];
  type: CollecteType;
  className?: string;
  /** Rend chaque ligne cliquable (drill-down vers la liste Collectes filtrée). */
  onRowClick?: (lieu: TopLieu) => void;
}

/**
 * Bloc 6 — Top 5 lieux. §06.04/§06.05/§06.11 Bloc 6.
 *   ZD : ordonné par tonnage — Lieu · Nb collectes · Tonnage · Taux de recyclage.
 *   AG : ordonné par repas donnés — Lieu · Nb collectes · Repas donnés · Repas/pax.
 */
export function TopLieuxBloc({ items, type, className, onRowClick }: Props) {
  const isZd = type === 'zero_dechet';
  const clickable = onRowClick != null;
  return (
    <Card className={className} data-testid="bloc-6-top-lieux">
      <CardHeader>
        <CardTitle>Top 5 lieux</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-savr-neutral-500">
            Aucune donnée sur la période.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="px-3 py-2">Lieu</th>
                  <th className="px-3 py-2">Nombre de collectes</th>
                  {isZd ? (
                    <>
                      <th className="px-3 py-2">Tonnage</th>
                      <th className="px-3 py-2">Taux de recyclage</th>
                    </>
                  ) : (
                    <>
                      <th className="px-3 py-2">Repas donnés</th>
                      <th className="px-3 py-2">Repas/pax</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((l) => (
                  <tr
                    key={l.lieu_id}
                    className={`border-t border-savr-neutral-100 hover:bg-savr-neutral-50 ${
                      clickable
                        ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-savr-primary-400'
                        : ''
                    }`}
                    data-testid="top-lieu-row"
                    {...(clickable
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'aria-label': `Voir les collectes — ${l.lieu_nom}`,
                          onClick: () => onRowClick(l),
                          onKeyDown: (e: KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowClick(l);
                            }
                          },
                        }
                      : {})}
                  >
                    <td className="px-3 py-2 font-medium">{l.lieu_nom}</td>
                    <td className="px-3 py-2">{l.nb_collectes}</td>
                    {isZd ? (
                      <>
                        <td className="px-3 py-2">
                          <TonnageDisplay kg={l.tonnage_kg ?? 0} />
                        </td>
                        <td className="px-3 py-2">
                          {l.taux_recyclage != null
                            ? `${l.taux_recyclage.toFixed(1)} %`
                            : '—'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2">{l.repas_donnes ?? 0}</td>
                        <td className="px-3 py-2">
                          {l.repas_par_pax != null
                            ? l.repas_par_pax.toFixed(2)
                            : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
