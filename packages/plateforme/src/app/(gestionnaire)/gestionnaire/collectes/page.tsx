'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  evenement_nom: string | null;
  lieu_nom: string | null;
  statut_consolide: string | null;
}

export default function GestionnaireCollectesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/gestionnaire/collectes')
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-savr-primary-800">Collectes</h1>

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">
          Aucune collecte sur vos lieux.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Lieu</th>
                <th className="px-3 py-2">Événement</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                  onClick={() => router.push(`/gestionnaire/collectes/${c.id}`)}
                >
                  <td className="px-3 py-2">
                    {c.date_collecte
                      ? new Date(c.date_collecte).toLocaleDateString('fr-FR')
                      : '—'}
                  </td>
                  <td className="px-3 py-2">{c.lieu_nom ?? '—'}</td>
                  <td className="px-3 py-2">{c.evenement_nom ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={c.type === 'zero_dechet' ? 'info' : 'success'}
                    >
                      {c.type === 'zero_dechet' ? 'ZD' : 'AG'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <CollecteStatutBadge
                      statut={c.statut_consolide ?? c.statut}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
