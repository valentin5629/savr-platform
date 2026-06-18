'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CollecteTypeTabs,
  type CollecteType,
} from '@/components/dashboards/index.js';

interface Lieu {
  nom: string;
  code_postal: string | null;
  ville: string | null;
}
interface Evenement {
  nom_evenement: string | null;
  pax: number | null;
  lieux: Lieu | Lieu[] | null;
}
interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  traiteur_nom: string | null;
  repas_donnes: number | null;
  evenements: Evenement | Evenement[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// §11 §7 — Liste des événements/collectes du client organisateur, lecture seule.
// Pas de bouton « Programmer » (rôle jamais self-service), pas de fiche éditable.
function CollectesContent() {
  const router = useRouter();
  const params = useSearchParams();
  const initialTab =
    params.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const [tab, setTab] = useState<CollecteType>(initialTab);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ type: tab });
    const from = params.get('from');
    const to = params.get('to');
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    fetch(`/api/v1/organisateur/collectes?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [tab, params]);

  function changeTab(t: CollecteType) {
    setTab(t);
    const usp = new URLSearchParams(Array.from(params.entries()));
    usp.set('type', t);
    router.replace(`/organisateur/collectes?${usp}`);
  }

  const isZd = tab === 'zero_dechet';

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
        <h1 className="text-2xl font-bold text-savr-primary-800">
          Mes collectes
        </h1>
        <Button variant="ghost" onClick={exportCsv}>
          Exporter CSV
        </Button>
      </div>

      <CollecteTypeTabs value={tab} onChange={changeTab} />

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">
          Aucune collecte sur la période sélectionnée.
        </p>
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
                <th className="px-3 py-2">{isZd ? 'Recyclage' : 'Repas'}</th>
                <th className="px-3 py-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const evt = one(c.evenements);
                const lieu = one(evt?.lieux ?? null);
                return (
                  <tr key={c.id} className="border-t border-savr-neutral-100">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {c.date_collecte}
                      {c.heure_collecte
                        ? ` ${c.heure_collecte.slice(0, 5)}`
                        : ''}
                    </td>
                    <td className="px-3 py-2">{evt?.nom_evenement ?? '—'}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{lieu?.nom ?? '—'}</div>
                      <div className="text-xs text-savr-neutral-500">
                        {[lieu?.code_postal, lieu?.ville]
                          .filter(Boolean)
                          .join(' ')}
                      </div>
                    </td>
                    <td className="px-3 py-2">{c.traiteur_nom ?? '—'}</td>
                    <td className="px-3 py-2">{evt?.pax ?? '—'}</td>
                    <td className="px-3 py-2">
                      {isZd
                        ? c.taux_recyclage != null
                          ? `${c.taux_recyclage.toFixed(1)} %`
                          : '—'
                        : (c.repas_donnes ?? '—')}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="neutral">
                        {c.statut === 'realisee_sans_collecte'
                          ? 'Aucun repas collecté'
                          : c.statut}
                      </Badge>
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

export default function ClientOrganisateurCollectesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <CollectesContent />
    </Suspense>
  );
}
