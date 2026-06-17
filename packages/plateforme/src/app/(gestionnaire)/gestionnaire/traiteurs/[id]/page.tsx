'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TraiteurDetail {
  id: string;
  nom: string;
  logo_url: string | null;
  ville: string | null;
  description_activite: string | null;
  stats_12m: {
    nb_collectes_zd: number;
    nb_collectes_ag: number;
    tonnage_zd_kg: number;
    taux_recyclage_moyen: number | null;
    repas_donnes: number;
  };
}

export default function TraiteurDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [traiteur, setTraiteur] = useState<TraiteurDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/gestionnaire/traiteurs/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((j) => {
        if (j) setTraiteur(j.data as TraiteurDetail);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return <p className="text-sm text-savr-neutral-500">Chargement…</p>;
  if (notFound)
    return (
      <p className="text-sm text-savr-neutral-500">Traiteur non trouvé.</p>
    );
  if (!traiteur) return null;

  const s = traiteur.stats_12m;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          ←
        </Button>
        <div className="flex items-center gap-3">
          {traiteur.logo_url && (
            <img
              src={traiteur.logo_url}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-savr-primary-800">
              {traiteur.nom}
            </h1>
            {traiteur.ville && (
              <p className="text-sm text-savr-neutral-500">{traiteur.ville}</p>
            )}
          </div>
        </div>
      </div>

      {traiteur.description_activite && (
        <p className="text-sm text-savr-neutral-700">
          {traiteur.description_activite}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activité sur vos lieux (12 mois)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <div>
            <div className="text-xs text-savr-neutral-500">Collectes ZD</div>
            <div className="text-xl font-bold">{s.nb_collectes_zd}</div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">Tonnage ZD</div>
            <div className="text-xl font-bold">
              {s.tonnage_zd_kg > 0 ? `${s.tonnage_zd_kg.toFixed(0)} kg` : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">Taux recyclage</div>
            <div className="text-xl font-bold">
              {s.taux_recyclage_moyen != null
                ? `${s.taux_recyclage_moyen.toFixed(1)} %`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">Collectes AG</div>
            <div className="text-xl font-bold">{s.nb_collectes_ag}</div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">Repas donnés</div>
            <div className="text-xl font-bold">
              {s.repas_donnes > 0 ? s.repas_donnes : '—'}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
