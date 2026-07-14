'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  evenement_nom: string | null;
  lieu_nom: string | null;
  statut_consolide: string | null;
}

function GestionnaireCollectesContent() {
  const router = useRouter();
  const params = useSearchParams();
  // Drill-down depuis les Top listes du dashboard (lieu / traiteur). Miroir exact :
  // le drill-down porte aussi type + période (from/to) + statut `cloturee` pour que
  // le nombre de lignes = le chiffre du Top liste.
  const lieuFiltre = params.get('lieu');
  const traiteurFiltre = params.get('traiteur');
  const typeFiltre = params.get('type');
  const statutFiltre = params.get('statut');
  const fromFiltre = params.get('from');
  const toFiltre = params.get('to');
  const [filtreLabel, setFiltreLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (lieuFiltre) qs.set('lieu_id', lieuFiltre);
    if (traiteurFiltre) qs.set('traiteur_id', traiteurFiltre);
    if (typeFiltre) qs.set('type', typeFiltre);
    if (statutFiltre) qs.set('statut', statutFiltre);
    if (fromFiltre) qs.set('from', fromFiltre);
    if (toFiltre) qs.set('to', toFiltre);
    const suffix = qs.toString() ? `?${qs}` : '';
    fetch(`/api/v1/gestionnaire/collectes${suffix}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [
    lieuFiltre,
    traiteurFiltre,
    typeFiltre,
    statutFiltre,
    fromFiltre,
    toFiltre,
  ]);

  useEffect(() => {
    if (lieuFiltre) setFiltreLabel(readCollecteFiltreLabel('lieu', lieuFiltre));
    else if (traiteurFiltre)
      setFiltreLabel(readCollecteFiltreLabel('traiteur', traiteurFiltre));
    else setFiltreLabel(null);
  }, [lieuFiltre, traiteurFiltre]);

  function clearFiltre() {
    const usp = new URLSearchParams(Array.from(params.entries()));
    ['lieu', 'traiteur', 'type', 'statut', 'from', 'to'].forEach((k) =>
      usp.delete(k),
    );
    const s = usp.toString();
    router.replace(`/gestionnaire/collectes${s ? `?${s}` : ''}`);
  }

  const chipLabel = lieuFiltre
    ? `Lieu : ${filtreLabel ?? rows[0]?.lieu_nom ?? 'lieu sélectionné'}`
    : traiteurFiltre
      ? `Traiteur : ${filtreLabel ?? 'traiteur sélectionné'}`
      : null;
  const chipScope = (() => {
    const parts: string[] = [];
    if (statutFiltre === 'cloturee') parts.push('clôturées');
    const per = periodeCourte(fromFiltre, toFiltre);
    if (per) parts.push(per);
    return parts.length ? parts.join(' · ') : undefined;
  })();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-savr-primary-800">Collectes</h1>

      {chipLabel && (
        <CollecteFiltreActif
          label={chipLabel}
          scope={chipScope}
          onClear={clearFiltre}
        />
      )}

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

export default function GestionnaireCollectesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <GestionnaireCollectesContent />
    </Suspense>
  );
}
