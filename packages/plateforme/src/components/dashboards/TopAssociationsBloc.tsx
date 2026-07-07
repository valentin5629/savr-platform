'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TopAssociation } from './blocs-types.js';

interface Props {
  items: TopAssociation[];
  className?: string;
}

/**
 * Bloc 3 AG — Top associations bénéficiaires, ordonné par repas reçus
 * (§06.04 l.218, §06.05 l.233, §06.11 hérite §06.04). Colonnes : Association ·
 * Ville · Nombre de collectes · Repas reçus. La colonne « Distance moyenne (km) »
 * du §06.05 n'est pas rendue en V1 (pas de source de distance asso↔lieu ;
 * cohérent avec sa suppression côté traiteur §06.04 l.223 — cf. _Divergences).
 */
export function TopAssociationsBloc({ items, className }: Props) {
  return (
    <Card className={className} data-testid="bloc-3ag-top-associations">
      <CardHeader>
        <CardTitle>Top associations bénéficiaires</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-savr-neutral-500">
            Aucune association bénéficiaire sur la période.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="px-3 py-2">Association</th>
                  <th className="px-3 py-2">Ville</th>
                  <th className="px-3 py-2">Nombre de collectes</th>
                  <th className="px-3 py-2">Repas reçus</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr
                    key={a.association_id}
                    className="border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                    data-testid="top-association-row"
                  >
                    <td className="px-3 py-2 font-medium">{a.nom}</td>
                    <td className="px-3 py-2">{a.ville ?? '—'}</td>
                    <td className="px-3 py-2">{a.nb_collectes}</td>
                    <td className="px-3 py-2">{a.repas_recus}</td>
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
