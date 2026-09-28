'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { libelleDateHeure } from '@/lib/format-date-collecte';
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

const TIRET = <span className="text-savr-neutral-400">—</span>;

/**
 * Bloc 5 — Prochaines collectes programmées (fenêtre 30 j à venir).
 * Grain = collecte. §06.04/§06.05/§06.11 Bloc 5. Même Data Table que les
 * listes Collectes (décision Val 2026-09-28), tri côté client.
 */
export function ProchainesCollectesBloc({
  items,
  showTraiteur = false,
  hrefFor,
  className,
}: Props) {
  const router = useRouter();

  const colonnes = useMemo<ColumnDef<ProchaineCollecte, unknown>[]>(() => {
    const traiteur: ColumnDef<ProchaineCollecte, unknown> = {
      id: 'traiteur',
      header: 'Traiteur',
      accessorFn: (c) => c.traiteur_nom ?? '',
      cell: ({ row: { original: c } }) => c.traiteur_nom ?? TIRET,
    };
    return [
      {
        id: 'date',
        header: 'Date',
        enableHiding: false,
        accessorFn: (c) => `${c.date_collecte} ${c.heure_collecte ?? ''}`,
        cell: ({ row: { original: c } }) => (
          <span className="whitespace-nowrap font-semibold tabular-nums">
            {libelleDateHeure(c.date_collecte.slice(0, 10), c.heure_collecte)}
          </span>
        ),
      },
      {
        id: 'evenement',
        header: 'Événement',
        accessorFn: (c) => c.evenement_nom ?? '',
        // Lien conservé (clic du nom, ouverture dans un nouvel onglet) en plus
        // du clic sur toute la ligne.
        meta: { interactive: true },
        cell: ({ row: { original: c } }) => {
          const href = hrefFor?.(c);
          if (!c.evenement_nom) return TIRET;
          return href ? (
            <a
              href={href}
              className="font-medium text-savr-neutral-900 hover:underline"
            >
              {c.evenement_nom}
            </a>
          ) : (
            <span className="font-medium">{c.evenement_nom}</span>
          );
        },
      },
      {
        id: 'lieu',
        header: 'Lieu',
        accessorFn: (c) => c.lieu_nom ?? '',
        cell: ({ row: { original: c } }) => c.lieu_nom ?? TIRET,
      },
      ...(showTraiteur ? [traiteur] : []),
      {
        id: 'statut',
        header: 'Statut',
        accessorFn: (c) => c.statut,
        cell: ({ row: { original: c } }) => (
          <CollecteStatutBadge statut={c.statut} vue="client" />
        ),
      },
    ];
  }, [hrefFor, showTraiteur]);

  const cliquable = items.some((c) => hrefFor?.(c));

  return (
    <Card className={className} data-testid="bloc-5-prochaines">
      <CardHeader>
        <CardTitle>Prochaines collectes</CardTitle>
      </CardHeader>
      <CardContent>
        <DataGrid
          columns={colonnes}
          data={items}
          getRowId={(c) => c.id}
          initialSorting={[{ id: 'date', desc: false }]}
          onRowClick={
            cliquable
              ? (c) => {
                  const href = hrefFor?.(c);
                  if (href) router.push(href);
                }
              : undefined
          }
          rowLabel={(c) =>
            `Ouvrir ${c.evenement_nom ?? 'la collecte'} du ${libelleDateHeure(c.date_collecte.slice(0, 10), c.heure_collecte)}`
          }
          empty={
            <p className="text-sm text-savr-neutral-500">
              Aucune collecte à venir sur les 30 prochains jours.
            </p>
          }
        />
      </CardContent>
    </Card>
  );
}
