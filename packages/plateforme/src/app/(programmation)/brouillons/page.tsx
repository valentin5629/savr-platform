'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle, FileEdit, CalendarDays, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface BrouillonRow {
  id: string;
  nom_evenement: string | null;
  nom_client_organisateur: string | null;
  created_at: string;
  collectes: { type: string; date_collecte: string }[];
}

export default function BrouillonsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<BrouillonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/v1/programmation/evenements?statut=brouillon')
      .then((r) => r.json() as Promise<{ data: BrouillonRow[] }>)
      .then((d) => setRows(d.data ?? []))
      .finally(() => setLoading(false));
  }, []);

  const { confirmer, dialogue } = useConfirm();
  const handleDelete = async (id: string) => {
    if (
      !(await confirmer({
        title: 'Supprimer ce brouillon ?',
        children: 'Cette action est irréversible.',
        confirmLabel: 'Supprimer',
        variant: 'destructive',
      }))
    )
      return;
    setDeleting(id);
    await fetch(`/api/v1/programmation/evenements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    setRows((prev) => prev.filter((r) => r.id !== id));
    setDeleting(null);
  };

  return (
    <div className="space-y-6">
      {dialogue}
      <PageHeader
        title="Mes brouillons"
        tone="neutral"
        size="xl"
        actions={
          <Button asChild>
            <Link href="/programmer/nouveau">
              <PlusCircle />
              Nouvelle programmation
            </Link>
          </Button>
        }
      />

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-savr-lg" />
          ))}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <EmptyState
          icon={<FileEdit className="h-10 w-10 text-savr-neutral-400" />}
          title="Aucun brouillon"
          description="Vos programmations enregistrées en brouillon apparaîtront ici."
          action={{
            label: 'Programmer une collecte',
            onClick: () => router.push('/programmer/nouveau'),
          }}
        />
      )}

      {!loading && rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-4 flex items-center justify-between gap-4 hover:border-savr-primary-300 transition-colors"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="font-medium text-savr-neutral-900 truncate">
                  {row.nom_client_organisateur ??
                    row.nom_evenement ??
                    'Sans nom'}
                </p>
                <Text
                  as="div"
                  variant="hint"
                  className="flex items-center gap-3"
                >
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {row.collectes[0]?.date_collecte ?? 'Date à définir'}
                  </span>
                  <span>
                    {row.collectes.map((c) => c.type.toUpperCase()).join(' + ')}
                  </span>
                </Text>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/programmer/brouillon/${row.id}`}>
                    Reprendre
                  </Link>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleDelete(row.id)}
                  disabled={deleting === row.id}
                  className="text-savr-error hover:bg-savr-error-subtle hover:border-savr-error"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
