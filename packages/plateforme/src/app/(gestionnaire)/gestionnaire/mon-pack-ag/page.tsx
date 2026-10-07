'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
} from '@/components/ui/data-grid';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { libelleTypePack } from '@/lib/libelles/pack';
import { formatDateParis } from '@savr/shared/src/temps/index.js';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';

interface PackActif {
  id: string;
  reference: string | null;
  nb_collectes_total: number;
  nb_collectes_restantes: number;
  date_debut: string | null;
  date_fin: string | null;
  statut: string;
}
interface ConsommationRow {
  collecte_id: string;
  date_collecte: string | null;
  /** Crédit consommé par une annulation tardive, sans collecte réalisée (§05). */
  annulee_tardivement: boolean;
  evenement: string | null;
  lieu: string | null;
  repas_donnes: number;
  associations: { nom: string | null; repas: number }[];
}
interface PackData {
  pack_actif: PackActif | null;
  historique_consommation: ConsommationRow[];
}

// Historique des collectes AG du pack — même Data Table que les listes
// Collectes (décision Val 2026-09-28). SANS tri : la route plafonne à 50
// lignes (`.limit(50)`), trier cet extrait ferait croire à un ordre global.
const COLONNES_CONSOMMATION: ColumnDef<ConsommationRow, unknown>[] = [
  {
    id: 'date',
    header: 'Date',
    enableSorting: false,
    enableHiding: false,
    accessorFn: (c) => c.date_collecte ?? '',
    cell: ({ row: { original: c } }) =>
      c.date_collecte ? (
        <span className="whitespace-nowrap font-semibold tabular-nums">
          {libelleDateHeure(c.date_collecte.slice(0, 10), null)}
        </span>
      ) : (
        <CelluleVide />
      ),
  },
  {
    id: 'evenement',
    header: 'Événement',
    enableSorting: false,
    accessorFn: (c) => c.evenement ?? '',
    cell: ({ row: { original: c } }) => (
      <span className="inline-flex flex-wrap items-center justify-end gap-2 sm:justify-start">
        {c.evenement ?? <CelluleVide />}
        {c.annulee_tardivement && (
          <Badge variant="neutral" size="sm">
            Annulée tardivement
          </Badge>
        )}
      </span>
    ),
  },
  {
    id: 'lieu',
    header: 'Lieu',
    enableSorting: false,
    accessorFn: (c) => c.lieu ?? '',
    cell: ({ row: { original: c } }) => c.lieu ?? <CelluleVide />,
  },
  {
    id: 'repas',
    header: 'Repas donnés',
    enableSorting: false,
    accessorFn: (c) => c.repas_donnes,
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row: { original: c } }) =>
      c.annulee_tardivement ? <CelluleVide /> : c.repas_donnes,
  },
  {
    id: 'associations',
    header: 'Association(s)',
    cell: ({ row: { original: c } }) =>
      c.associations
        .map((a) => a.nom)
        .filter(Boolean)
        .join(', ') || <CelluleVide />,
  },
];

export default function MonPackAgPage() {
  const [data, setData] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/gestionnaire/pack-ag')
      .then((r) => r.json())
      .then((j) => setData(j.data as PackData))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;

  const pack = data?.pack_actif;
  const packEpuise = pack && pack.nb_collectes_restantes === 0;
  const packBas =
    pack &&
    !packEpuise &&
    pack.nb_collectes_restantes <= 0.1 * pack.nb_collectes_total;

  return (
    <div className="space-y-6">
      <PageHeader title="Mon pack AG" />

      {!pack ? (
        <Card>
          <CardContent className="py-8">
            <EmptyState
              size="inline"
              className="text-center"
              title="Aucun pack Anti-Gaspi actif. Contactez votre responsable Savr."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pack actif
              {packEpuise && <Badge variant="error">Épuisé</Badge>}
              {packBas && <Badge variant="warning">Bientôt épuisé</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <div className="text-savr-neutral-500">Référence</div>
                <div>{libelleTypePack(pack.reference)}</div>
              </div>
              <div>
                <div className="text-savr-neutral-500">Crédits restants</div>
                <div className="text-xl font-bold">
                  {pack.nb_collectes_restantes}{' '}
                  <Text as="span" tone="faint" className="font-normal">
                    / {pack.nb_collectes_total}
                  </Text>
                </div>
              </div>
              <div>
                <div className="text-savr-neutral-500">Début</div>
                <div>{formatDateParis(pack.date_debut) || '—'}</div>
              </div>
              <div>
                <div className="text-savr-neutral-500">Fin</div>
                <div>{formatDateParis(pack.date_fin) || '—'}</div>
              </div>
            </div>

            {/* Barre de progression */}
            <div className="h-2 w-full overflow-hidden rounded-savr-full bg-savr-neutral-200">
              <div
                className="h-full rounded-savr-full bg-savr-primary-500 transition-all"
                style={{
                  width: `${Math.max(0, (pack.nb_collectes_restantes / pack.nb_collectes_total) * 100)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historique consommation */}
      {data && data.historique_consommation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historique des collectes AG</CardTitle>
          </CardHeader>
          <CardContent>
            <DataGrid
              columnsToggle={false}
              columns={COLONNES_CONSOMMATION}
              data={data.historique_consommation}
              getRowId={(c) => c.collecte_id}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
