'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface EvenementRow {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  taille_bracket: string;
  lieu_nom: string | null;
  lieu_ville: string | null;
  traiteur_nom: string | null;
  statut_consolide: string;
  nb_collectes_zd: number;
  nb_collectes_ag: number;
  programmee_par_moi: boolean;
}

function EvenementsContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<EvenementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    const from = params.get('from');
    const to = params.get('to');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    fetch(`/api/v1/gestionnaire/evenements?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as EvenementRow[]))
      .finally(() => setLoading(false));
  }, [params]);

  function exportCsv() {
    const qs = new URLSearchParams();
    const from = params.get('from');
    const to = params.get('to');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    window.open(`/api/v1/gestionnaire/evenements/export-csv?${qs}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-savr-primary-800">Événements</h1>
        <Button variant="ghost" onClick={exportCsv}>
          Exporter CSV
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">Aucun événement.</p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Événement</th>
                <th className="px-3 py-2">Lieu</th>
                <th className="px-3 py-2">Traiteur</th>
                <th className="px-3 py-2">Pax</th>
                <th className="px-3 py-2">Collectes</th>
                <th className="px-3 py-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                  onClick={() =>
                    router.push(`/gestionnaire/evenements/${e.id}`)
                  }
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    {e.date_evenement ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {e.nom_evenement ?? '—'}
                      {e.programmee_par_moi && (
                        <Badge variant="info" className="ml-1 text-xs">
                          Moi
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-savr-neutral-500">
                      {e.taille_bracket}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{e.lieu_nom ?? '—'}</div>
                    <div className="text-xs text-savr-neutral-500">
                      {e.lieu_ville ?? ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{e.traiteur_nom ?? '—'}</td>
                  <td className="px-3 py-2">{e.pax ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs">
                      {e.nb_collectes_zd > 0 && (
                        <span className="mr-1">ZD: {e.nb_collectes_zd}</span>
                      )}
                      {e.nb_collectes_ag > 0 && (
                        <span>AG: {e.nb_collectes_ag}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        e.statut_consolide === 'Terminé'
                          ? 'success'
                          : e.statut_consolide === 'Annulé'
                            ? 'neutral'
                            : 'info'
                      }
                    >
                      {e.statut_consolide}
                    </Badge>
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

export default function GestionnaireEvenementsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <EvenementsContent />
    </Suspense>
  );
}
