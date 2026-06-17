'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TraiteurRow {
  id: string;
  nom: string;
  logo_url: string | null;
  nb_collectes_12m: number;
  tonnage_12m_kg: number;
  taux_recyclage_moyen: number | null;
  repas_donnes_12m: number;
}

export default function GestionnaireTraiteursPage() {
  const router = useRouter();
  const [rows, setRows] = useState<TraiteurRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/gestionnaire/traiteurs')
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as TraiteurRow[]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-savr-primary-800">Traiteurs</h1>
      <p className="text-sm text-savr-neutral-500">
        Traiteurs intervenus sur vos lieux (24 derniers mois).
      </p>

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">Aucun traiteur.</p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="px-3 py-2">Traiteur</th>
                <th className="px-3 py-2">Collectes 12 m</th>
                <th className="px-3 py-2">Tonnage ZD 12 m</th>
                <th className="px-3 py-2">Taux recyclage</th>
                <th className="px-3 py-2">Repas AG 12 m</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  className="cursor-pointer border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                  onClick={() => router.push(`/gestionnaire/traiteurs/${t.id}`)}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {t.logo_url && (
                        <img
                          src={t.logo_url}
                          alt=""
                          className="h-6 w-6 rounded-full object-cover"
                        />
                      )}
                      <span className="font-medium">{t.nom}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{t.nb_collectes_12m}</td>
                  <td className="px-3 py-2">
                    {t.tonnage_12m_kg > 0
                      ? `${t.tonnage_12m_kg.toFixed(0)} kg`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {t.taux_recyclage_moyen != null
                      ? `${t.taux_recyclage_moyen.toFixed(1)} %`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {t.repas_donnes_12m > 0 ? t.repas_donnes_12m : '—'}
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
