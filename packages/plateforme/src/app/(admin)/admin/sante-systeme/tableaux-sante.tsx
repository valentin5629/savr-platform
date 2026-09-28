'use client';

/**
 * Tableaux de la page Santé système (Intégrations externes, Batchs cron) en
 * Data Table commune (DataGrid). Composant client séparé : la page est un
 * Server Component, et les colonnes portent des fonctions de rendu qui ne
 * peuvent pas traverser la frontière serveur → client.
 *
 * Les vues `v_ops_integrations` et `v_ops_batchs` sont lues en entier (pas de
 * pagination) → tri navigateur.
 */

import { Badge } from '@/components/ui/badge';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';

export interface OpsIntegration {
  service: string;
  dernier_appel_at: string | null;
  nb_echecs_24h: number;
}

export interface OpsBatch {
  job_name: string;
  dernier_run_at: string | null;
  statut: string | null;
  nb_traite: number | null;
}

export function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <Badge variant={ok ? 'success' : 'error'}>
      {label ?? (ok ? 'OK' : 'KO')}
    </Badge>
  );
}

const dateHeure = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })
    : '—';

const COLONNES_INTEGRATIONS: ColumnDef<OpsIntegration, unknown>[] = [
  {
    id: 'service',
    header: 'Service',
    accessorFn: (i) => i.service,
    meta: { className: 'font-medium uppercase' },
    cell: ({ row: { original: i } }) => i.service,
  },
  {
    id: 'dernier_appel',
    header: 'Dernier appel',
    accessorFn: (i) => i.dernier_appel_at ?? '',
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: i } }) => dateHeure(i.dernier_appel_at),
  },
  {
    id: 'echecs_24h',
    header: 'Échecs 24h',
    accessorFn: (i) => i.nb_echecs_24h,
    cell: ({ row: { original: i } }) => (
      <span
        className={
          i.nb_echecs_24h > 0
            ? 'text-savr-error font-medium'
            : 'text-savr-neutral-500'
        }
      >
        {i.nb_echecs_24h}
      </span>
    ),
  },
];

const COLONNES_BATCHS: ColumnDef<OpsBatch, unknown>[] = [
  {
    id: 'job',
    header: 'Job',
    accessorFn: (b) => b.job_name,
    meta: { className: 'font-mono text-xs' },
    cell: ({ row: { original: b } }) => b.job_name,
  },
  {
    id: 'dernier_run',
    header: 'Dernier run',
    accessorFn: (b) => b.dernier_run_at ?? '',
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: b } }) => dateHeure(b.dernier_run_at),
  },
  {
    id: 'statut',
    header: 'Statut',
    accessorFn: (b) => b.statut ?? '',
    cell: ({ row: { original: b } }) =>
      b.statut ? (
        <StatusBadge ok={b.statut === 'completed'} label={b.statut} />
      ) : (
        <span className="text-savr-neutral-400 text-xs">jamais exécuté</span>
      ),
  },
  {
    id: 'traites',
    header: 'Traités',
    accessorFn: (b) => b.nb_traite ?? undefined,
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: b } }) => b.nb_traite ?? '—',
  },
];

export function TableauIntegrations({
  integrations,
}: {
  integrations: OpsIntegration[];
}) {
  return (
    <DataGrid
      columns={COLONNES_INTEGRATIONS}
      data={integrations}
      getRowId={(i) => i.service}
      empty={
        <p className="text-sm text-savr-neutral-500">
          Aucune intégration suivie pour le moment.
        </p>
      }
    />
  );
}

export function TableauBatchs({ batchs }: { batchs: OpsBatch[] }) {
  return (
    <DataGrid
      columns={COLONNES_BATCHS}
      data={batchs}
      getRowId={(b) => b.job_name}
      empty={
        <p className="text-sm text-savr-neutral-500">
          Aucun batch exécuté pour le moment.
        </p>
      }
    />
  );
}
