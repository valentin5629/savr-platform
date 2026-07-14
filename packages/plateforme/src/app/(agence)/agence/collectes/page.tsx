'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import {
  CollecteTypeTabs,
  type CollecteType,
} from '@/components/dashboards/index.js';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';

interface Lieu {
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface Evenement {
  nom_evenement: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  lieux: Lieu | Lieu[] | null;
}
interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  realisee_at: string | null;
  evenements: Evenement | Evenement[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function rapportDisponible(realiseeAt: string | null): boolean {
  if (!realiseeAt) return false;
  return Date.now() - new Date(realiseeAt).getTime() >= 24 * 3600 * 1000;
}

function CollectesContent() {
  const router = useRouter();
  const params = useSearchParams();
  const initialTab =
    params.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const [tab, setTab] = useState<CollecteType>(initialTab);
  // Drill-down « Top 5 lieux » du dashboard agence → filtre sur le lieu.
  const lieuFiltre = params.get('lieu');
  const [filtreLabel, setFiltreLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ type: tab });
    const from = params.get('from');
    const to = params.get('to');
    const statut = params.get('statut');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (statut) qs.set('statut', statut);
    if (lieuFiltre) qs.set('lieu_id', lieuFiltre);
    fetch(`/api/v1/agence/collectes?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [tab, params, lieuFiltre]);

  useEffect(() => {
    setFiltreLabel(
      lieuFiltre ? readCollecteFiltreLabel('lieu', lieuFiltre) : null,
    );
  }, [lieuFiltre]);

  function changeTab(t: CollecteType) {
    setTab(t);
    const usp = new URLSearchParams(Array.from(params.entries()));
    usp.set('type', t);
    router.replace(`/agence/collectes?${usp}`);
  }
  function clearFiltre() {
    const usp = new URLSearchParams(Array.from(params.entries()));
    ['lieu', 'statut', 'from', 'to'].forEach((k) => usp.delete(k));
    router.replace(`/agence/collectes?${usp}`);
  }

  const lieuNomDesRows = (() => {
    const evt = one(rows[0]?.evenements ?? null);
    const lieu = one(evt?.lieux ?? null);
    return lieu?.nom ?? null;
  })();
  const chipLabel = lieuFiltre
    ? `Lieu : ${filtreLabel ?? lieuNomDesRows ?? 'lieu sélectionné'}`
    : null;
  const chipScope = (() => {
    const parts: string[] = [];
    if (params.get('statut') === 'cloturee') parts.push('clôturées');
    const per = periodeCourte(params.get('from'), params.get('to'));
    if (per) parts.push(per);
    return parts.length ? parts.join(' · ') : undefined;
  })();

  function exportCsv() {
    const qs = new URLSearchParams({ type: tab });
    const from = params.get('from');
    const to = params.get('to');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    window.open(`/api/v1/exports/collectes?${qs}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-savr-primary-800">Collectes</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={exportCsv}>
            Exporter CSV
          </Button>
          <Button asChild>
            <a href={`/programmer/nouveau?type=${tab}`}>
              Programmer un événement
            </a>
          </Button>
        </div>
      </div>

      <CollecteTypeTabs value={tab} onChange={changeTab} />

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
        <p className="text-sm text-savr-neutral-500">Aucune collecte.</p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Lieu</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Pax</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Rapport</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const evt = one(c.evenements);
                const lieu = one(evt?.lieux ?? null);
                const dispo = rapportDisponible(c.realisee_at);
                return (
                  <tr
                    key={c.id}
                    className="cursor-pointer border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                    onClick={() => router.push(`/agence/collectes/${c.id}`)}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.date_collecte}
                      {c.heure_collecte
                        ? ` ${c.heure_collecte.slice(0, 5)}`
                        : ''}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{lieu?.nom ?? '—'}</div>
                      <div className="text-xs text-savr-neutral-500">
                        {[lieu?.adresse_acces, lieu?.code_postal, lieu?.ville]
                          .filter(Boolean)
                          .join(' ')}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {evt?.nom_client_organisateur ?? '—'}
                    </td>
                    <td className="px-3 py-2">{evt?.pax ?? '—'}</td>
                    <td className="px-3 py-2">
                      <CollecteStatutBadge statut={c.statut} />
                    </td>
                    <td className="px-3 py-2">
                      {dispo ? (
                        <span className="text-savr-primary-700">
                          Disponible ⬇
                        </span>
                      ) : (
                        <span className="text-savr-neutral-400">À venir</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AgenceCollectesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <CollectesContent />
    </Suspense>
  );
}
