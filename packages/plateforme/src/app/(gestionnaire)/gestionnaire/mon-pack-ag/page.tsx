'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface PackActif {
  id: string;
  reference: string | null;
  nb_collectes_total: number;
  nb_collectes_restantes: number;
  date_debut: string | null;
  date_fin: string | null;
  statut: string;
}
interface ConsommationRow {
  collecte_id: string;
  date_collecte: string | null;
  evenement: string | null;
  lieu: string | null;
  repas_donnes: number;
  associations: { nom: string | null; repas: number }[];
}
interface PackData {
  pack_actif: PackActif | null;
  historique_packs: PackActif[];
  historique_consommation: ConsommationRow[];
}

export default function MonPackAgPage() {
  const [data, setData] = useState<PackData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/gestionnaire/pack-ag')
      .then((r) => r.json())
      .then((j) => setData(j.data as PackData))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return <p className="text-sm text-savr-neutral-500">Chargement…</p>;

  const pack = data?.pack_actif;
  const packEpuise = pack && pack.nb_collectes_restantes === 0;
  const packBas =
    pack &&
    !packEpuise &&
    pack.nb_collectes_restantes <= 0.1 * pack.nb_collectes_total;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">Mon pack AG</h1>

      {!pack ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-savr-neutral-500">
            Aucun pack Anti-Gaspi actif. Contactez votre responsable Savr.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pack actif
              {packEpuise && <Badge variant="error">Épuisé</Badge>}
              {packBas && <Badge variant="warning">Bientôt épuisé</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <div className="text-savr-neutral-500">Référence</div>
                <div>{pack.reference ?? '—'}</div>
              </div>
              <div>
                <div className="text-savr-neutral-500">Crédits restants</div>
                <div className="text-xl font-bold">
                  {pack.nb_collectes_restantes}{' '}
                  <span className="text-sm font-normal text-savr-neutral-400">
                    / {pack.nb_collectes_total}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-savr-neutral-500">Début</div>
                <div>{pack.date_debut ?? '—'}</div>
              </div>
              <div>
                <div className="text-savr-neutral-500">Fin</div>
                <div>{pack.date_fin ?? '—'}</div>
              </div>
            </div>

            {/* Barre de progression */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-savr-neutral-200">
              <div
                className="h-full rounded-full bg-savr-primary-500 transition-all"
                style={{
                  width: `${Math.max(0, (pack.nb_collectes_restantes / pack.nb_collectes_total) * 100)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Historique consommation */}
      {data && data.historique_consommation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historique des collectes AG</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="py-1">Date</th>
                  <th className="py-1">Événement</th>
                  <th className="py-1">Lieu</th>
                  <th className="py-1">Repas donnés</th>
                  <th className="py-1">Association(s)</th>
                </tr>
              </thead>
              <tbody>
                {data.historique_consommation.map((c) => (
                  <tr
                    key={c.collecte_id}
                    className="border-t border-savr-neutral-100"
                  >
                    <td className="py-1 whitespace-nowrap">
                      {c.date_collecte ?? '—'}
                    </td>
                    <td className="py-1">{c.evenement ?? '—'}</td>
                    <td className="py-1">{c.lieu ?? '—'}</td>
                    <td className="py-1">{c.repas_donnes}</td>
                    <td className="py-1 text-xs text-savr-neutral-500">
                      {c.associations
                        .map((a) => a.nom)
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Historique packs */}
      {data && data.historique_packs.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Historique packs</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="py-1">Référence</th>
                  <th className="py-1">Collectes</th>
                  <th className="py-1">Période</th>
                  <th className="py-1">Statut</th>
                </tr>
              </thead>
              <tbody>
                {data.historique_packs.map((p) => (
                  <tr key={p.id} className="border-t border-savr-neutral-100">
                    <td className="py-1">{p.reference ?? '—'}</td>
                    <td className="py-1">
                      {p.nb_collectes_total - p.nb_collectes_restantes} /{' '}
                      {p.nb_collectes_total}
                    </td>
                    <td className="py-1">
                      {p.date_debut ?? '—'} → {p.date_fin ?? '—'}
                    </td>
                    <td className="py-1">
                      <Badge variant="neutral">{p.statut}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
