'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AssociationForm,
  type AssociationFormValues,
} from '@/components/admin/association-form';
import { horairesParDefaut } from '@/components/admin/horaires-ouverture-editor';

type AssociationApi = {
  nom: string;
  adresse: string;
  region: string;
  ville: string;
  contact_nom: string | null;
  contact_email: string;
  contact_telephone: string | null;
  capacite_max_beneficiaires: number | null;
  types_aliments_acceptes: string[] | null;
  description_rapport_impact: string;
  commentaires_internes: string | null;
  instructions_acces: string | null;
  siren: string | null;
  logo_url: string | null;
  id_point_collecte_mts1: string | null;
  habilitee_attestation_fiscale: boolean;
  date_expiration_habilitation: string | null;
  actif: boolean;
  horaires_ouverture: AssociationFormValues['horaires_ouverture'] | null;
};

export default function ModifierAssociationPage() {
  const params = useParams<{ id: string }>();
  const [initialValues, setInitialValues] =
    useState<Partial<AssociationFormValues> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/admin/associations/${params.id}`)
      .then((r) => r.json())
      .then((d: AssociationApi) => {
        setInitialValues({
          nom: d.nom,
          adresse: d.adresse,
          region: d.region as AssociationFormValues['region'],
          ville: d.ville,
          contact_nom: d.contact_nom ?? '',
          contact_email: d.contact_email,
          contact_telephone: d.contact_telephone ?? '',
          capacite_max_beneficiaires:
            d.capacite_max_beneficiaires?.toString() ?? '',
          types_aliments_acceptes: d.types_aliments_acceptes?.join(', ') ?? '',
          description_rapport_impact: d.description_rapport_impact,
          commentaires_internes: d.commentaires_internes ?? '',
          instructions_acces: d.instructions_acces ?? '',
          siren: d.siren ?? '',
          logo_url: d.logo_url ?? '',
          id_point_collecte_mts1: d.id_point_collecte_mts1 ?? '',
          habilitee_attestation_fiscale: d.habilitee_attestation_fiscale,
          date_expiration_habilitation: d.date_expiration_habilitation ?? '',
          actif: d.actif,
          horaires_ouverture: d.horaires_ouverture ?? horairesParDefaut(),
        });
      })
      .catch(() => setError('Erreur chargement association'));
  }, [params.id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/admin/associations/${params.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-savr-neutral-900">
          Modifier l'association
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
        <AssociationForm
          associationId={params.id}
          initialValues={initialValues}
        />
      )}
    </div>
  );
}
