'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { fmtKg, fmtPct } from '@/lib/format';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { IconButton } from '@/components/ui/icon-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HistoriqueCollectesTable } from '@/components/collecte/historique-collectes-table';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

interface TraiteurDetail {
  id: string;
  nom: string;
  logo_url: string | null;
  stats_12m: {
    nb_collectes_zd: number;
    nb_collectes_ag: number;
    tonnage_zd_kg: number;
    taux_recyclage_moyen: number | null;
    repas_donnes: number;
  };
  historique_collectes: {
    id: string;
    type: string;
    statut: string;
    date_collecte: string | null;
    lieu_nom: string | null;
  }[];
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
  const [logoKo, setLogoKo] = useState(false);

  useEffect(() => {
    setLogoKo(false);
    fetch(`/api/v1/gestionnaire/traiteurs/${encodeURIComponent(id)}`)
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

  if (loading) return <LoadingState />;
  if (notFound) return <Text>Traiteur non trouvé.</Text>;
  if (!traiteur) return null;

  const s = traiteur.stats_12m;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <IconButton aria-label="Retour" onClick={() => router.back()}>
          <ArrowLeft />
        </IconButton>
        <div className="flex items-center gap-3">
          {traiteur.logo_url && !logoKo && (
            <img
              // logo_url porte une CLÉ R2, pas une URL : seul le proxy la résout,
              // dans le périmètre v_traiteurs_gestionnaire.
              src={`/api/v1/gestionnaire/traiteurs/${encodeURIComponent(id)}/logo`}
              alt=""
              onError={() => setLogoKo(true)}
              className="h-10 w-10 rounded-full object-cover"
            />
          )}
          <Heading level={1} tone="primary">
            {traiteur.nom}
          </Heading>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activité sur vos lieux (12 mois)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <div>
            <Text as="div" variant="hint">
              Collectes ZD
            </Text>
            <div className="text-xl font-bold">{s.nb_collectes_zd}</div>
          </div>
          <div>
            <Text as="div" variant="hint">
              Tonnage ZD
            </Text>
            <div className="text-xl font-bold">
              {s.tonnage_zd_kg > 0 ? fmtKg(s.tonnage_zd_kg) : '—'}
            </div>
          </div>
          <div>
            <Text as="div" variant="hint">
              Taux recyclage
            </Text>
            <div className="text-xl font-bold">
              {s.taux_recyclage_moyen != null
                ? fmtPct(s.taux_recyclage_moyen)
                : '—'}
            </div>
          </div>
          <div>
            <Text as="div" variant="hint">
              Collectes AG
            </Text>
            <div className="text-xl font-bold">{s.nb_collectes_ag}</div>
          </div>
          <div>
            <Text as="div" variant="hint">
              Repas donnés
            </Text>
            <div className="text-xl font-bold">
              {s.repas_donnes > 0 ? s.repas_donnes : '—'}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Historique collectes sur les lieux de l'organisation (§06.05 l.439) */}
      {traiteur.historique_collectes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historique des collectes (12 mois)</CardTitle>
          </CardHeader>
          <CardContent>
            <HistoriqueCollectesTable
              rows={traiteur.historique_collectes}
              showLieu
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
