'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Transporteur {
  id: string;
  nom: string;
  siren: string;
  adresse: string;
  code_postal: string;
  ville: string;
  types_vehicules: string[];
  type_tms: string;
  code_transporteur_mts1: string | null;
  contact_nom: string;
  contact_email: string;
  contact_telephone: string;
  tarif_par_course: number | null;
  actif: boolean;
  commentaires_internes: string | null;
}

const TYPE_TMS_LABELS: Record<string, string> = {
  mts1: 'MTS-1',
  a_toutes: 'A Toutes! (V1.1)',
  autre: 'Autre',
};

export default function TransporteurDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [transporteur, setTransporteur] = useState<Transporteur | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/admin/transporteurs/${params.id}`)
      .then((r) => r.json())
      .then((d: Transporteur) => setTransporteur(d))
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

  if (error || !transporteur) {
    return (
      <p className="text-savr-error-600">
        {error ?? 'Transporteur introuvable'}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Truck className="h-5 w-5 text-savr-neutral-600" />
        <h1 className="text-xl font-bold text-savr-neutral-900">
          {transporteur.nom}
        </h1>
        <Badge variant="neutral">
          {TYPE_TMS_LABELS[transporteur.type_tms] ?? transporteur.type_tms}
        </Badge>
        {transporteur.actif ? (
          <Badge variant="success">Actif</Badge>
        ) : (
          <Badge variant="neutral">Inactif</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Informations générales
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">SIREN</dt>
              <dd className="font-mono font-medium">{transporteur.siren}</dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Adresse</dt>
              <dd className="font-medium">
                {transporteur.adresse}, {transporteur.code_postal}{' '}
                {transporteur.ville}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500 mb-1">Types véhicules</dt>
              <dd className="flex flex-wrap gap-1">
                {transporteur.types_vehicules.map((v) => (
                  <Badge key={v} variant="neutral">
                    {v}
                  </Badge>
                ))}
              </dd>
            </div>
            {transporteur.tarif_par_course !== null && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Tarif / course</dt>
                <dd className="font-medium">
                  {transporteur.tarif_par_course} €
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">Contact</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Nom</dt>
              <dd className="font-medium">{transporteur.contact_nom}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Email</dt>
              <dd className="font-medium">{transporteur.contact_email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Téléphone</dt>
              <dd className="font-medium">{transporteur.contact_telephone}</dd>
            </div>
          </dl>
        </Card>

        {(transporteur.code_transporteur_mts1 ||
          transporteur.commentaires_internes) && (
          <Card className="p-6 space-y-4">
            <h2 className="font-semibold text-savr-neutral-800">
              Admin / Intégration
            </h2>
            <dl className="space-y-2 text-sm">
              {transporteur.code_transporteur_mts1 && (
                <div className="flex justify-between">
                  <dt className="text-savr-neutral-500">Code MTS-1</dt>
                  <dd className="font-mono font-medium">
                    {transporteur.code_transporteur_mts1}
                  </dd>
                </div>
              )}
              {transporteur.commentaires_internes && (
                <div>
                  <dt className="text-savr-neutral-500 mb-1">
                    Commentaires internes
                  </dt>
                  <dd className="bg-savr-neutral-50 rounded p-2">
                    {transporteur.commentaires_internes}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" asChild>
          <a href={`/admin/transporteurs/${transporteur.id}/modifier`}>
            Modifier
          </a>
        </Button>
      </div>
    </div>
  );
}
