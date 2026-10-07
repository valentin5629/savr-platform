'use client';

import { useEffect, useState, useCallback } from 'react';
import { Zap, AlertTriangle, Plus, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { AlertBar } from '@/components/ui/alert-bar';
import { LoadingState } from '@/components/ui/loading-state';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/ui/page-header';
import { ActifBadge } from '@/components/ui/actif-badge';

interface ConfigAutoAccept {
  id: string;
  organisation_id: string;
  auto_accept_actif: boolean;
  seuil_pax_min: number | null;
  seuil_pax_max: number | null;
  notes: string | null;
  created_at: string;
  organisations: { raison_sociale: string } | null;
  associations: { nom: string } | null;
  transporteurs: { nom: string } | null;
}

const columns: Column<ConfigAutoAccept>[] = [
  {
    key: 'organisation',
    header: 'Traiteur',
    render: (row) => (
      <div className="flex items-center gap-1.5">
        <Building2 className="h-3.5 w-3.5 text-savr-neutral-400" />
        {row.organisations?.raison_sociale ?? row.organisation_id}
      </div>
    ),
  },
  {
    key: 'associations',
    header: 'Association fixe',
    render: (row) =>
      row.associations?.nom ?? (
        <span className="text-savr-neutral-400">Algo</span>
      ),
  },
  {
    key: 'transporteurs',
    header: 'Transporteur fixe',
    render: (row) =>
      row.transporteurs?.nom ?? (
        <span className="text-savr-neutral-400">Algo</span>
      ),
  },
  {
    key: 'seuil',
    header: 'Seuil PAX',
    render: (row) =>
      row.seuil_pax_min != null || row.seuil_pax_max != null ? (
        `${row.seuil_pax_min ?? '—'} – ${row.seuil_pax_max ?? '—'}`
      ) : (
        <span className="text-savr-neutral-400">Tous</span>
      ),
  },
  {
    key: 'auto_accept_actif',
    header: 'Auto-accept',
    sortable: true,
    render: (row) => <ActifBadge actif={row.auto_accept_actif} />,
  },
  {
    key: 'notes',
    header: 'Notes',
    sortable: true,
    render: (row) =>
      row.notes ?? <span className="text-savr-neutral-400">—</span>,
  },
];

export default function AutoAcceptPage() {
  const [configs, setConfigs] = useState<ConfigAutoAccept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const { toast } = useToast();

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/config-auto-accept');
      if (!res.ok) throw new Error('Erreur chargement configuration');
      const json = (await res.json()) as { data: ConfigAutoAccept[] };
      setConfigs(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const toggleAutoAccept = async (id: string, current: boolean) => {
    setToggling(id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/config-auto-accept?id=${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_accept_actif: !current }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Erreur mise à jour');
      }
      toast({
        title: `Auto-accept ${!current ? 'activé' : 'désactivé'}.`,
        variant: 'success',
      });
      await loadConfigs();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setToggling(null);
    }
  };

  const columnsWithToggle: Column<ConfigAutoAccept>[] = [
    ...columns,
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <Button
          size="sm"
          variant="secondary"
          disabled={toggling === row.id}
          onClick={() => toggleAutoAccept(row.id, row.auto_accept_actif)}
        >
          {row.auto_accept_actif ? 'Désactiver' : 'Activer'}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuration auto-accept"
        description="Activation de la validation automatique par traiteur"
        tone="neutral"
        size="xl"
        weight="semibold"
        icon={<Zap className="h-6 w-6 text-savr-warning" />}
        actions={
          <Button size="sm" variant="secondary" disabled>
            <Plus />
            Nouvelle config
          </Button>
        }
      />

      {error && (
        <AlertBar
          variant="err"
          icon={<AlertTriangle />}
          className="font-normal"
        >
          {error}
        </AlertBar>
      )}

      {loading ? (
        <LoadingState variant="bloc" lignes={4} />
      ) : configs.length === 0 ? (
        <EmptyState
          icon={<Zap className="h-8 w-8 text-savr-warning" />}
          title="Aucune configuration"
          description="Aucun traiteur n'a de configuration auto-accept définie."
        />
      ) : (
        <DataTable
          columns={columnsWithToggle}
          data={configs}
          clientSort
          keyExtractor={(r) => r.id}
        />
      )}

      <AlertBar variant="warn" className="font-normal">
        L'auto-accept déclenche la validation sans action humaine dès que l'algo
        AG trouve une combinaison association + transporteur satisfaisant les
        seuils configurés. L'événement outbox{' '}
        <code className="text-xs">attribution.validee</code> est émis
        immédiatement.
      </AlertBar>
    </div>
  );
}
