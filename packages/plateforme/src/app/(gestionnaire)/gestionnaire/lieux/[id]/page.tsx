'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';

interface LieuDetail {
  id: string;
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
  region: string | null;
  type_vehicule_max: string | null;
  capacite_maximum: number | null;
  acces_office: boolean | null;
  stationnement: string | null;
  acces_details: string | null;
  contraintes_horaires: string | null;
  flux_autorises: string[] | null;
  photos_urls: string[] | null;
  collectes: {
    id: string;
    type: string;
    statut: string;
    date_collecte: string | null;
    collecte_flux?: { poids_reel_kg?: number | null }[];
  }[];
  top_traiteurs: { id: string; nom: string; nb: number; tonnage: number }[];
}

// Agrège le tonnage ZD par mois sur les 12 derniers mois (graphique évolution §06.05 l.371).
function evolutionMensuelle(
  collectes: LieuDetail['collectes'],
): { mois: string; kg: number }[] {
  const now = new Date();
  const buckets: { mois: string; key: string; kg: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      mois: d.toLocaleDateString('fr-FR', { month: 'short' }),
      kg: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const c of collectes) {
    if (!c.date_collecte) continue;
    const key = c.date_collecte.slice(0, 7);
    const bucket = byKey.get(key);
    if (!bucket) continue;
    const kg = (c.collecte_flux ?? []).reduce(
      (s, f) => s + (f.poids_reel_kg ?? 0),
      0,
    );
    bucket.kg += kg;
  }
  return buckets.map((b) => ({ mois: b.mois, kg: b.kg }));
}

export default function LieuDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [lieu, setLieu] = useState<LieuDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/gestionnaire/lieux/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((j) => {
        if (j) setLieu(j.data as LieuDetail);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return <p className="text-sm text-savr-neutral-500">Chargement…</p>;
  if (notFound)
    return <p className="text-sm text-savr-neutral-500">Lieu non trouvé.</p>;
  if (!lieu) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          ←
        </Button>
        <h1 className="text-2xl font-bold text-savr-primary-800">{lieu.nom}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div>
            <span className="text-savr-neutral-500">Adresse : </span>
            {[lieu.adresse_acces, lieu.code_postal, lieu.ville]
              .filter(Boolean)
              .join(', ') || '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Région : </span>
            {lieu.region ?? '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Capacité : </span>
            {lieu.capacite_maximum != null
              ? `${lieu.capacite_maximum} pers.`
              : '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Véhicule max : </span>
            {lieu.type_vehicule_max ? (
              <Badge variant="neutral">{lieu.type_vehicule_max}</Badge>
            ) : (
              '—'
            )}
          </div>
          <div>
            <span className="text-savr-neutral-500">Stationnement : </span>
            {lieu.stationnement ?? '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Accès office : </span>
            {lieu.acces_office == null
              ? '—'
              : lieu.acces_office
                ? 'Oui'
                : 'Non'}
          </div>
          {lieu.acces_details && (
            <div className="col-span-2">
              <span className="text-savr-neutral-500">Détails accès : </span>
              {lieu.acces_details}
            </div>
          )}
          {lieu.contraintes_horaires && (
            <div className="col-span-2">
              <span className="text-savr-neutral-500">
                Contraintes horaires :{' '}
              </span>
              {lieu.contraintes_horaires}
            </div>
          )}
          {lieu.flux_autorises && lieu.flux_autorises.length > 0 && (
            <div className="col-span-2 flex flex-wrap gap-1">
              <span className="text-savr-neutral-500">Flux autorisés : </span>
              {lieu.flux_autorises.map((f) => (
                <Badge key={f} variant="neutral">
                  {f}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Photos (si disponibles — §06.05 l.369) */}
      {lieu.photos_urls && lieu.photos_urls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Photos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {lieu.photos_urls.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Photo ${i + 1} du lieu`}
                className="h-28 w-40 rounded-savr-md border border-savr-neutral-200 object-cover"
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Évolution 12 mois (tonnage ZD par mois — §06.05 l.371) */}
      {lieu.collectes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Évolution du tonnage (12 mois)</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const data = evolutionMensuelle(lieu.collectes);
              const max = Math.max(1, ...data.map((d) => d.kg));
              return (
                <div
                  className="flex items-end gap-2"
                  data-testid="lieu-evolution-12m"
                >
                  {data.map((d, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center">
                      <div
                        className="w-full rounded-t bg-savr-primary-500"
                        style={{ height: `${(d.kg / max) * 96 + 2}px` }}
                        title={`${d.kg.toFixed(0)} kg`}
                      />
                      <span className="mt-1 text-[10px] text-savr-neutral-500">
                        {d.mois}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Top traiteurs */}
      {lieu.top_traiteurs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Principaux traiteurs (12 mois)</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="py-1">Traiteur</th>
                  <th className="py-1">Nb collectes</th>
                  <th className="py-1">Tonnage (kg)</th>
                </tr>
              </thead>
              <tbody>
                {lieu.top_traiteurs.map((t) => (
                  <tr key={t.id} className="border-t border-savr-neutral-100">
                    <td className="py-1">{t.nom}</td>
                    <td className="py-1">{t.nb}</td>
                    <td className="py-1">{t.tonnage.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Historique collectes */}
      {lieu.collectes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historique collectes (12 mois)</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="py-1">Date</th>
                  <th className="py-1">Type</th>
                  <th className="py-1">Statut</th>
                </tr>
              </thead>
              <tbody>
                {lieu.collectes.map((c) => (
                  <tr key={c.id} className="border-t border-savr-neutral-100">
                    <td className="py-1">{c.date_collecte ?? '—'}</td>
                    <td className="py-1">
                      <Badge variant="neutral">
                        {c.type === 'zero_dechet' ? 'ZD' : 'AG'}
                      </Badge>
                    </td>
                    <td className="py-1">
                      <CollecteStatutBadge statut={c.statut} />
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
