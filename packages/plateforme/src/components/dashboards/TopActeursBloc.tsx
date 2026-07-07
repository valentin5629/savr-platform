'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TonnageDisplay } from './TonnageDisplay.js';
import type { CollecteType } from './CollecteTypeTabs.js';
import type { TopActeur } from './blocs-types.js';

interface Props {
  items: TopActeur[];
  type: CollecteType;
  /** « Commercial » (traiteur) ou « Traiteur » (gestionnaire). */
  acteurLabel: 'Commercial' | 'Traiteur';
  className?: string;
}

/**
 * Bloc 7 — Top 5 acteurs, ordonné par nombre de collectes (§06.04 l.187/269,
 * §06.05 l.204/258). Traiteur → commerciaux (evenements.created_by) ; gestionnaire
 * → traiteurs opérationnels. RETIRÉ côté agence (§06.11 diff #8) : ce composant
 * n'est pas monté sur la page agence.
 */
export function TopActeursBloc({ items, type, acteurLabel, className }: Props) {
  const isZd = type === 'zero_dechet';
  const titre =
    acteurLabel === 'Traiteur' ? 'Top 5 traiteurs' : 'Top 5 commerciaux';
  return (
    <Card className={className} data-testid="bloc-7-top-acteurs">
      <CardHeader>
        <CardTitle>{titre}</CardTitle>
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
                  <th className="px-3 py-2">{acteurLabel}</th>
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
                {items.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                    data-testid="top-acteur-row"
                  >
                    <td className="px-3 py-2 font-medium">{a.label}</td>
                    <td className="px-3 py-2">{a.nb_collectes}</td>
                    {isZd ? (
                      <>
                        <td className="px-3 py-2">
                          <TonnageDisplay kg={a.tonnage_kg ?? 0} />
                        </td>
                        <td className="px-3 py-2">
                          {a.taux_recyclage != null
                            ? `${a.taux_recyclage.toFixed(1)} %`
                            : '—'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2">{a.repas_donnes ?? 0}</td>
                        <td className="px-3 py-2">
                          {a.repas_par_pax != null
                            ? a.repas_par_pax.toFixed(2)
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
