'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface LieuRow {
  id: string;
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
  type_vehicule_max: string | null;
  capacite_maximum: number | null;
  actif: boolean;
  nb_collectes_12m: number;
  tonnage_12m_kg: number;
}

export default function GestionnaireLieuxPage() {
  const router = useRouter();
  const [rows, setRows] = useState<LieuRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/gestionnaire/lieux')
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as LieuRow[]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-savr-primary-800">Lieux</h1>

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">Aucun lieu associé.</p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="px-3 py-2">Nom</th>
                <th className="px-3 py-2">Adresse</th>
                <th className="px-3 py-2">Capacité</th>
                <th className="px-3 py-2">Collectes 12 m</th>
                <th className="px-3 py-2">Tonnage ZD 12 m</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr
                  key={l.id}
                  className="cursor-pointer border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                  onClick={() => router.push(`/gestionnaire/lieux/${l.id}`)}
                >
                  <td className="px-3 py-2 font-medium">{l.nom}</td>
                  <td className="px-3 py-2">
                    <div>{l.adresse_acces ?? '—'}</div>
                    <div className="text-xs text-savr-neutral-400">
                      {[l.code_postal, l.ville].filter(Boolean).join(' ')}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {l.capacite_maximum != null
                      ? `${l.capacite_maximum} pers.`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">{l.nb_collectes_12m}</td>
                  <td className="px-3 py-2">
                    {l.tonnage_12m_kg > 0
                      ? `${l.tonnage_12m_kg.toFixed(0)} kg`
                      : '—'}
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
