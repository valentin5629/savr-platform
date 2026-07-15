'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Heart,
  MapPin,
  FileText,
  Clock,
  Users,
  PackageCheck,
  BadgeCheck,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHero } from '@/components/ui/page-hero';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';

interface Association {
  id: string;
  nom: string;
  adresse: string;
  ville: string;
  region: string;
  contact_nom: string | null;
  contact_email: string;
  contact_telephone: string | null;
  habilitee_attestation_fiscale: boolean;
  date_expiration_habilitation: string | null;
  description_rapport_impact: string;
  capacite_max_beneficiaires: number | null;
  types_aliments_acceptes: string[] | null;
  horaires_ouverture: Record<string, unknown> | null;
  logo_url: string | null;
  instructions_acces: string | null;
  siren: string | null;
  commentaires_internes: string | null;
  id_point_collecte_mts1: string | null;
  actif: boolean;
  derniere_verification: string | null;
  // KPI dérivé (API) — collectes AG réalisées rattachées, 30 derniers jours.
  collectes_realisees_30j: number;
}

// BlocHeader — gabarit Design System partagé avec la fiche collecte (#226) :
// pastille primary + titre extrabold tracking serré (leviers §10 #2/#7).
function BlocHeader({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-savr-md bg-savr-primary-50 text-savr-primary-700">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <h2 className="truncate text-base font-extrabold tracking-[-0.01em] text-savr-neutral-900">
        {title}
      </h2>
    </div>
  );
}

function frDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('fr-FR');
}

export default function AssociationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [asso, setAsso] = useState<Association | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/admin/associations/${params.id}`)
      .then((r) => r.json())
      .then((d: Association) => setAsso(d))
      .catch(() => setError('Erreur chargement'))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !asso) {
    return (
      <p className="text-savr-error-600">
        {error ?? 'Association introuvable'}
      </p>
    );
  }

  const horaires = Array.isArray(asso.horaires_ouverture)
    ? (asso.horaires_ouverture as {
        jour: string;
        ouvert: boolean;
        creneaux?: { debut: string; fin: string }[];
      }[])
    : [];

  return (
    <div className="space-y-4">
      {/* En-tête — bandeau navy (levier #2) : nom + adresse + statut + Modifier */}
      <PageHero
        icon={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Retour"
              className="inline-flex h-9 w-9 items-center justify-center rounded-savr-md text-savr-white transition-colors hover:bg-savr-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Heart className="h-6 w-6 text-savr-primary-200" />
          </div>
        }
        title={asso.nom}
        subtitle={`${asso.adresse}, ${asso.ville} (${asso.region})`}
        actions={
          <>
            {asso.actif ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="neutral">Inactive</Badge>
            )}
            <Button variant="secondary" size="sm" asChild>
              <a href={`/admin/associations/${asso.id}/modifier`}>Modifier</a>
            </Button>
          </>
        }
      />

      {/* Bandeau KPI — capacité (config), collectes réalisées 30 j, habilitation */}
      <StatCardGrid desktopCols={3}>
        <StatCard
          label="Capacité max (bénéficiaires)"
          value={asso.capacite_max_beneficiaires ?? '—'}
          icon={<Users />}
        />
        <StatCard
          label="Collectes réalisées (30 j)"
          value={asso.collectes_realisees_30j}
          icon={<PackageCheck />}
        />
        <StatCard
          label="Habilitation 2041-GE"
          value={asso.habilitee_attestation_fiscale ? 'Oui' : 'Non'}
          icon={<BadgeCheck />}
        />
      </StatCardGrid>

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {/* Coordonnées */}
        <Card className="p-5 space-y-4">
          <BlocHeader icon={MapPin} title="Coordonnées" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="sm:col-span-2">
              <dt className="text-savr-neutral-500">Adresse</dt>
              <dd className="font-medium">
                {asso.adresse}, {asso.ville} ({asso.region})
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Contact</dt>
              <dd className="font-medium">{asso.contact_nom ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Téléphone</dt>
              <dd className="font-medium">{asso.contact_telephone ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-savr-neutral-500">Email</dt>
              <dd className="font-medium">{asso.contact_email}</dd>
            </div>
            {asso.instructions_acces && (
              <div className="sm:col-span-2">
                <dt className="text-savr-neutral-500 mb-1">
                  Instructions d'accès
                </dt>
                <dd className="rounded-savr-md bg-savr-neutral-50 p-2 font-medium">
                  {asso.instructions_acces}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        {/* Rapport d'impact */}
        <Card className="p-5 space-y-4">
          <BlocHeader icon={FileText} title="Rapport d'impact" />
          <p className="text-sm text-savr-neutral-700">
            {asso.description_rapport_impact}
          </p>
          {asso.types_aliments_acceptes &&
            asso.types_aliments_acceptes.length > 0 && (
              <div>
                <p className="mb-2 text-sm text-savr-neutral-500">
                  Aliments acceptés
                </p>
                <div className="flex flex-wrap gap-1">
                  {asso.types_aliments_acceptes.map((t) => (
                    <Badge key={t} variant="neutral">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-savr-neutral-500">Logo</span>
            {asso.logo_url ? (
              <img
                src={`/api/v1/admin/uploads/logo?key=${encodeURIComponent(
                  asso.logo_url,
                )}`}
                alt={`Logo ${asso.nom}`}
                className="h-12 w-auto rounded-savr-md border border-savr-neutral-200 object-contain"
              />
            ) : (
              <span className="text-savr-neutral-400">—</span>
            )}
          </div>
        </Card>

        {/* Horaires d'ouverture — affiché seulement si renseigné */}
        {horaires.length > 0 && (
          <Card className="p-5 space-y-4">
            <BlocHeader icon={Clock} title="Horaires d'ouverture" />
            <dl className="space-y-1 text-sm">
              {horaires.map((j) => (
                <div key={j.jour} className="flex justify-between">
                  <dt className="text-savr-neutral-500 capitalize">{j.jour}</dt>
                  <dd className="font-medium">
                    {j.ouvert && j.creneaux && j.creneaux.length > 0
                      ? j.creneaux.map((c) => `${c.debut}–${c.fin}`).join(', ')
                      : 'Fermé'}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        {/* Admin / Ops */}
        <Card className="p-5 space-y-4">
          <BlocHeader icon={Settings2} title="Admin / Ops" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-savr-neutral-500">SIREN</dt>
              <dd className="font-mono font-medium">{asso.siren ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Habilitation 2041-GE</dt>
              <dd className="font-medium">
                {asso.habilitee_attestation_fiscale ? 'Oui' : 'Non'}
                {asso.date_expiration_habilitation
                  ? ` (exp. ${frDate(asso.date_expiration_habilitation)})`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Dernière vérification</dt>
              <dd className="font-medium">
                {frDate(asso.derniere_verification)}
              </dd>
            </div>
            {asso.id_point_collecte_mts1 && (
              <div>
                <dt className="text-savr-neutral-500">ID point MTS-1</dt>
                <dd className="font-mono font-medium">
                  {asso.id_point_collecte_mts1}
                </dd>
              </div>
            )}
            {asso.commentaires_internes && (
              <div className="sm:col-span-2">
                <dt className="text-savr-neutral-500 mb-1">
                  Commentaires internes
                </dt>
                <dd className="rounded-savr-md bg-savr-neutral-50 p-2 font-medium">
                  {asso.commentaires_internes}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>
    </div>
  );
}
