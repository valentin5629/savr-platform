'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Zap,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';

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
    render: (row) =>
      row.auto_accept_actif ? (
        <Badge variant="success">Actif</Badge>
      ) : (
        <Badge variant="neutral">Inactif</Badge>
      ),
  },
  {
    key: 'notes',
    header: 'Notes',
    render: (row) =>
      row.notes ?? <span className="text-savr-neutral-400">—</span>,
  },
];

export default function AutoAcceptPage() {
  const [configs, setConfigs] = useState<ConfigAutoAccept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

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
    setSuccessMsg(null);
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
      setSuccessMsg(`Auto-accept ${!current ? 'activé' : 'désactivé'}.`);
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-6 w-6 text-amber-500" />
          <div>
            <h1 className="text-xl font-semibold text-savr-neutral-900">
              Configuration auto-accept
            </h1>
            <p className="text-sm text-savr-neutral-500">
              Activation de la validation automatique par traiteur
            </p>
          </div>
        </div>
        <Button size="sm" variant="secondary" disabled>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nouvelle config
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : configs.length === 0 ? (
        <EmptyState
          icon={<Zap className="h-8 w-8 text-amber-400" />}
          title="Aucune configuration"
          description="Aucun traiteur n'a de configuration auto-accept définie."
        />
      ) : (
        <DataTable
          columns={columnsWithToggle}
          data={configs}
          keyExtractor={(r) => r.id}
        />
      )}

      <Card className="border border-amber-100 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          L'auto-accept déclenche la validation sans action humaine dès que
          l'algo AG trouve une combinaison association + transporteur
          satisfaisant les seuils configurés. L'événement outbox{' '}
          <code className="text-xs">attribution.validee</code> est émis
          immédiatement.
        </p>
      </Card>
    </div>
  );
}
