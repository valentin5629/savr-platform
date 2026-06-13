'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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
  description_rapport_impact: string;
  capacite_max_beneficiaires: number | null;
  types_aliments_acceptes: string[] | null;
  horaires_ouverture: Record<string, unknown> | null;
  commentaires_internes: string | null;
  id_point_collecte_mts1: string | null;
  actif: boolean;
  derniere_verification: string | null;
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
        <Skeleton className="h-8 w-48" />
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Heart className="h-5 w-5 text-savr-neutral-600" />
        <h1 className="text-xl font-bold text-savr-neutral-900">{asso.nom}</h1>
        {asso.actif ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="neutral">Inactive</Badge>
        )}
        {asso.habilitee_attestation_fiscale && (
          <Badge variant="success">Habilitation 2041-GE</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">Coordonnées</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-savr-neutral-500">Adresse</dt>
              <dd className="font-medium">
                {asso.adresse}, {asso.ville} ({asso.region})
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Contact</dt>
              <dd className="font-medium">{asso.contact_nom ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Email</dt>
              <dd className="font-medium">{asso.contact_email}</dd>
            </div>
            {asso.contact_telephone && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Téléphone</dt>
                <dd className="font-medium">{asso.contact_telephone}</dd>
              </div>
            )}
            {asso.capacite_max_beneficiaires && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Capacité max</dt>
                <dd className="font-medium">
                  {asso.capacite_max_beneficiaires} bénéficiaires
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Description rapport impact
          </h2>
          <p className="text-sm text-savr-neutral-700">
            {asso.description_rapport_impact}
          </p>
          {asso.types_aliments_acceptes &&
            asso.types_aliments_acceptes.length > 0 && (
              <div>
                <p className="text-sm text-savr-neutral-500 mb-2">
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
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">Admin / Ops</h2>
          <dl className="space-y-2 text-sm">
            {asso.id_point_collecte_mts1 && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">ID point MTS-1</dt>
                <dd className="font-mono font-medium">
                  {asso.id_point_collecte_mts1}
                </dd>
              </div>
            )}
            {asso.derniere_verification && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Dernière vérification</dt>
                <dd className="font-medium">{asso.derniere_verification}</dd>
              </div>
            )}
            {asso.commentaires_internes && (
              <div>
                <dt className="text-savr-neutral-500 mb-1">
                  Commentaires internes
                </dt>
                <dd className="bg-savr-neutral-50 rounded p-2">
                  {asso.commentaires_internes}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" asChild>
          <a href={`/admin/associations/${asso.id}/modifier`}>Modifier</a>
        </Button>
      </div>
    </div>
  );
}
