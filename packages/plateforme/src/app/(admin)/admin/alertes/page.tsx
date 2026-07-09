'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import {
  SEVERITE_BADGE,
  severiteParCode,
  entiteHref,
} from '@/lib/alertes-admin.js';

interface Alerte {
  id: string;
  code: string;
  titre: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  statut: string;
  created_at: string;
  resolue_at: string | null;
}

const FILTRES = [
  { key: 'ouverte', label: 'Ouvertes' },
  { key: 'resolue', label: 'Résolues' },
  { key: 'all', label: 'Toutes' },
] as const;

export default function AlertesPage() {
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [loading, setLoading] = useState(true);
  const [statut, setStatut] = useState<string>('ouverte');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/v1/admin/alertes?statut=${statut}`)
      .then((r) => r.json())
      .then((d: { data?: Alerte[] }) => setAlertes(d.data ?? []))
      .finally(() => setLoading(false));
  }, [statut]);

  useEffect(() => {
    load();
  }, [load]);

  const resoudre = useCallback(
    async (id: string) => {
      setResolvingId(id);
      try {
        const res = await fetch(`/api/v1/admin/alertes/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'resoudre' }),
        });
        if (!res.ok) return;
        // Retrait optimiste de la vue « Ouvertes » ; sinon on rafraîchit le statut.
        if (statut === 'ouverte') {
          setAlertes((prev) => prev.filter((a) => a.id !== id));
        } else {
          setAlertes((prev) =>
            prev.map((a) =>
              a.id === id
                ? {
                    ...a,
                    statut: 'resolue',
                    resolue_at: new Date().toISOString(),
                  }
                : a,
            ),
          );
        }
      } finally {
        setResolvingId(null);
      }
    },
    [statut],
  );

  const columns: Column<Alerte>[] = [
    {
      key: 'severite',
      header: 'Sévérité',
      render: (row) => {
        const b = SEVERITE_BADGE[severiteParCode(row.code)];
        return <Badge variant={b.variant}>{b.label}</Badge>;
      },
    },
    {
      key: 'titre',
      header: 'Alerte',
      render: (row) => (
        <div className="max-w-xl">
          <p className="font-medium text-savr-neutral-900">{row.titre}</p>
          {row.message && (
            <p className="mt-0.5 text-xs text-savr-neutral-500">
              {row.message}
            </p>
          )}
          <p className="mt-0.5 font-mono text-[11px] text-savr-neutral-400">
            {row.code}
          </p>
        </div>
      ),
    },
    {
      key: 'entite',
      header: 'Entité',
      render: (row) => {
        const href = entiteHref(row.entity_type, row.entity_id);
        if (!row.entity_type)
          return <span className="text-neutral-400">—</span>;
        if (href) {
          return (
            <Link
              href={href}
              className="text-sm text-savr-primary-700 hover:underline"
            >
              {row.entity_type}
            </Link>
          );
        }
        return (
          <span className="text-sm text-savr-neutral-500">
            {row.entity_type}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Créée le',
      render: (row) => new Date(row.created_at).toLocaleString('fr-FR'),
    },
    {
      key: 'action',
      header: '',
      render: (row) =>
        row.statut === 'ouverte' ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={resolvingId === row.id}
            onClick={() => resoudre(row.id)}
          >
            {resolvingId === row.id ? 'Résolution…' : 'Résoudre'}
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-savr-neutral-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-savr-success" />
            Résolue
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-savr-primary-600" />
        <div>
          <h1 className="text-2xl font-semibold">Alertes</h1>
          <p className="text-sm text-savr-neutral-500">
            Alertes Admin in-app à traiter (packs, pesées, PDF, facturation,
            dispatch…). Le canal d&apos;action des alertes fonctionnelles est
            cet écran, pas Slack.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTRES.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatut(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              statut === f.key
                ? 'bg-savr-primary-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!loading && alertes.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="Aucune alerte"
          description={
            statut === 'ouverte'
              ? 'Aucune alerte ouverte à traiter.'
              : 'Aucune alerte dans cette vue.'
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={alertes}
          loading={loading}
          keyExtractor={(a) => a.id}
        />
      )}
    </div>
  );
}
