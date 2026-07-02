'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LieuForm, type LieuFormValues } from '@/components/admin/lieu-form';

type LieuApi = {
  nom: string;
  nom_alternatif: string | null;
  adresse_acces: string;
  code_postal: string;
  ville: string;
  acces_office: string | null;
  stationnement: string | null;
  type_vehicule_max: string;
  controle_acces_requis_default: boolean;
  actif: boolean;
  commentaire_lieu: string | null;
  siren: string | null;
  email_gestionnaire: string | null;
  reference_citeo: boolean;
};

export default function ModifierLieuPage() {
  const params = useParams<{ id: string }>();
  const [initialValues, setInitialValues] =
    useState<Partial<LieuFormValues> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/admin/lieux/${params.id}`)
      .then((r) => r.json())
      .then((d: LieuApi) => {
        setInitialValues({
          nom: d.nom,
          nom_alternatif: d.nom_alternatif ?? '',
          adresse_acces: d.adresse_acces,
          code_postal: d.code_postal,
          ville: d.ville,
          acces_office:
            (d.acces_office as LieuFormValues['acces_office']) ?? '',
          stationnement:
            (d.stationnement as LieuFormValues['stationnement']) ?? '',
          type_vehicule_max:
            d.type_vehicule_max as LieuFormValues['type_vehicule_max'],
          controle_acces_requis_default: d.controle_acces_requis_default,
          actif: d.actif,
          commentaire_lieu: d.commentaire_lieu ?? '',
          siren: d.siren ?? '',
          email_gestionnaire: d.email_gestionnaire ?? '',
          reference_citeo: d.reference_citeo,
        });
      })
      .catch(() => setError('Erreur chargement lieu'));
  }, [params.id]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/admin/lieux/${params.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-bold text-savr-neutral-900">
          Modifier le lieu
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
        <LieuForm lieuId={params.id} initialValues={initialValues} />
      )}
    </div>
  );
}
