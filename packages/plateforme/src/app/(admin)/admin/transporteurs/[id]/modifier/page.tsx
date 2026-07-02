'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TransporteurForm,
  type TransporteurFormValues,
} from '@/components/admin/transporteur-form';

type TransporteurApi = {
  nom: string;
  siren: string;
  contact_nom: string | null;
  contact_telephone: string | null;
  contact_email: string;
  adresse: string;
  code_postal: string;
  ville: string;
  types_vehicules: string[];
  types_collecte: string[] | null;
  type_tms: string;
  description_process_collecte: string | null;
  code_transporteur_mts1: string | null;
  actif: boolean;
};

export default function ModifierTransporteurPage() {
  const params = useParams<{ id: string }>();
  const [initialValues, setInitialValues] =
    useState<Partial<TransporteurFormValues> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/admin/transporteurs/${params.id}`)
      .then((r) => r.json())
      .then((d: TransporteurApi) => {
        setInitialValues({
          nom: d.nom,
          siren: d.siren,
          contact_nom: d.contact_nom ?? '',
          contact_telephone: d.contact_telephone ?? '',
          contact_email: d.contact_email,
          adresse: d.adresse,
          code_postal: d.code_postal,
          ville: d.ville,
          types_vehicules: d.types_vehicules ?? [],
          types_collecte: d.types_collecte ?? [],
          type_tms: d.type_tms as TransporteurFormValues['type_tms'],
          description_process_collecte: d.description_process_collecte ?? '',
          code_transporteur_mts1: d.code_transporteur_mts1 ?? '',
          actif: d.actif,
        });
      })
      .catch(() => setError('Erreur chargement transporteur'));
  }, [params.id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/admin/transporteurs/${params.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-savr-neutral-900">
          Modifier le transporteur
        </h1>
      </div>
      {error && <p className="text-savr-error-strong">{error}</p>}
      {!initialValues && !error && (
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {initialValues && (
        <TransporteurForm
          transporteurId={params.id}
          initialValues={initialValues}
        />
      )}
    </div>
  );
}
