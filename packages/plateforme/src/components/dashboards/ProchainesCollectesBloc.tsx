'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import type { ProchaineCollecte } from './blocs-types.js';

interface Props {
  items: ProchaineCollecte[];
  /** Colonne « Traiteur » (Bloc 5 gestionnaire §06.05 l.194). Off par défaut
   *  (§06.04 traiteur/agence : Date/Événement/Lieu/Statut). */
  showTraiteur?: boolean;
  /** Lien de la ligne → fiche collecte (traiteur/agence) ou détail événement
   *  (gestionnaire, §06.05 l.613). Undefined = ligne non cliquable. */
  hrefFor?: (item: ProchaineCollecte) => string | undefined;
  className?: string;
}

function formatDateHeure(date: string, heure: string | null): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  const jour = d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  return heure ? `${jour} · ${heure.slice(0, 5)}` : jour;
}

/**
 * Bloc 5 — Prochaines collectes programmées (fenêtre 30 j à venir).
 * Grain = collecte. §06.04/§06.05/§06.11 Bloc 5.
 */
export function ProchainesCollectesBloc({
  items,
  showTraiteur = false,
  hrefFor,
  className,
}: Props) {
  return (
    <Card className={className} data-testid="bloc-5-prochaines">
      <CardHeader>
        <CardTitle>Prochaines collectes</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-savr-neutral-500">
            Aucune collecte à venir sur les 30 prochains jours.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Événement</th>
                  <th className="px-3 py-2">Lieu</th>
                  {showTraiteur && <th className="px-3 py-2">Traiteur</th>}
                  <th className="px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const href = hrefFor?.(c);
                  return (
                    <tr
                      key={c.id}
                      className="border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                      data-testid="prochaine-row"
                    >
                      <td className="whitespace-nowrap px-3 py-2">
                        {formatDateHeure(c.date_collecte, c.heure_collecte)}
                      </td>
                      <td className="px-3 py-2 font-medium">
                        {href ? (
                          <a href={href} className="hover:underline">
                            {c.evenement_nom ?? '—'}
                          </a>
                        ) : (
                          (c.evenement_nom ?? '—')
                        )}
                      </td>
                      <td className="px-3 py-2">{c.lieu_nom ?? '—'}</td>
                      {showTraiteur && (
                        <td className="px-3 py-2">{c.traiteur_nom ?? '—'}</td>
                      )}
                      <td className="px-3 py-2">
                        <CollecteStatutBadge statut={c.statut} vue="client" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
