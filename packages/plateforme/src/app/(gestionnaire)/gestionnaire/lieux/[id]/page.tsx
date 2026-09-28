'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { MapPin, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { Skeleton } from '@/components/ui/skeleton';
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

type TopTraiteur = LieuDetail['top_traiteurs'][number];
type CollecteLigne = LieuDetail['collectes'][number];

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
      mois: d.toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
        month: 'short',
      }),
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

// Libellé « clé : valeur » de la card Informations (§10 §2.3 neutres tintés).
function Champ({
  libelle,
  children,
  large = false,
}: {
  libelle: string;
  children: React.ReactNode;
  large?: boolean;
}) {
  return (
    <div className={large ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-savr-neutral-500">
        {libelle}
      </dt>
      <dd className="mt-0.5 flex flex-wrap items-center gap-1 text-savr-neutral-900">
        {children}
      </dd>
    </div>
  );
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
  const [erreur, setErreur] = useState(false);

  const charger = useCallback(() => {
    setLoading(true);
    setErreur(false);
    setNotFound(false);
    fetch(`/api/v1/gestionnaire/lieux/${encodeURIComponent(id)}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (j) setLieu(j.data as LieuDetail);
      })
      // §10 §7 « Error » : un échec de chargement ne doit pas rendre une page vide.
      .catch(() => setErreur(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    charger();
  }, [charger]);

  // §10 §7 « Loading » : skeletons à la forme du contenu, jamais un spinner seul.
  if (loading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );

  if (erreur)
    return (
      <EmptyState
        icon={<TriangleAlert className="h-8 w-8" />}
        title="Impossible de charger ce lieu"
        description="Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
        action={{ label: 'Réessayer', onClick: charger }}
      />
    );

  if (notFound)
    return (
      <EmptyState
        icon={<MapPin className="h-8 w-8" />}
        title="Lieu non trouvé"
        description="Ce lieu n'existe pas ou n'est pas rattaché à votre organisation."
        action={{
          label: 'Retour aux lieux',
          onClick: () => router.push('/gestionnaire/lieux'),
        }}
      />
    );

  if (!lieu) return null;

  const adresseComplete =
    [lieu.adresse_acces, lieu.code_postal, lieu.ville]
      .filter(Boolean)
      .join(', ') || '—';

  const colonnesTraiteurs: Column<TopTraiteur>[] = [
    { key: 'nom', header: 'Traiteur', render: (t) => t.nom },
    { key: 'nb', header: 'Nb collectes', render: (t) => t.nb },
    {
      key: 'tonnage',
      header: 'Tonnage (kg)',
      render: (t) => t.tonnage.toFixed(0),
    },
  ];

  const colonnesCollectes: Column<CollecteLigne>[] = [
    {
      key: 'date_collecte',
      header: 'Date',
      render: (c) => c.date_collecte ?? '—',
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <Badge variant="neutral">
          {c.type === 'zero_dechet' ? 'ZD' : 'AG'}
        </Badge>
      ),
    },
    {
      key: 'statut',
      header: 'Statut',
      render: (c) => <CollecteStatutBadge statut={c.statut} />,
    },
  ];

  return (
    <div className="space-y-5">
      <Breadcrumb
        items={[
          { label: 'Lieux', href: '/gestionnaire/lieux' },
          { label: lieu.nom },
        ]}
      />

      <PageHero
        icon={<MapPin className="h-6 w-6 text-savr-primary-200" />}
        title={lieu.nom}
        subtitle={adresseComplete}
      />

      <Card>
        <CardHeader>
          <CardTitle>Informations</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <Champ libelle="Adresse">{adresseComplete}</Champ>
            <Champ libelle="Région">{lieu.region ?? '—'}</Champ>
            <Champ libelle="Capacité">
              {lieu.capacite_maximum != null
                ? `${lieu.capacite_maximum} pers.`
                : '—'}
            </Champ>
            <Champ libelle="Véhicule max">
              {lieu.type_vehicule_max ? (
                <Badge variant="neutral">{lieu.type_vehicule_max}</Badge>
              ) : (
                '—'
              )}
            </Champ>
            <Champ libelle="Stationnement">{lieu.stationnement ?? '—'}</Champ>
            <Champ libelle="Accès office">
              {lieu.acces_office == null
                ? '—'
                : lieu.acces_office
                  ? 'Oui'
                  : 'Non'}
            </Champ>
            {lieu.acces_details && (
              <Champ libelle="Détails accès" large>
                {lieu.acces_details}
              </Champ>
            )}
            {lieu.contraintes_horaires && (
              <Champ libelle="Contraintes horaires" large>
                {lieu.contraintes_horaires}
              </Champ>
            )}
            {lieu.flux_autorises && lieu.flux_autorises.length > 0 && (
              <Champ libelle="Flux autorisés" large>
                {lieu.flux_autorises.map((f) => (
                  <Badge key={f} variant="neutral">
                    {f}
                  </Badge>
                ))}
              </Champ>
            )}
          </dl>
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
                        title={`${d.mois} : ${d.kg.toFixed(0)} kg`}
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
            <DataTable
              columns={colonnesTraiteurs}
              data={lieu.top_traiteurs}
              keyExtractor={(t) => t.id}
            />
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
            <DataTable
              columns={colonnesCollectes}
              data={lieu.collectes}
              keyExtractor={(c) => c.id}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
