'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Lieu {
  id: string;
  nom: string;
  nom_alternatif: string | null;
  adresse_acces: string;
  code_postal: string;
  ville: string;
  region: string | null;
  type_vehicule_max: string;
  acces_office: string | null;
  stationnement: string | null;
  controle_acces_requis_default: boolean;
  flux_autorises: string[] | null;
  volume_max_bacs: number | null;
  contraintes_horaires: string | null;
  acces_details: string | null;
  commentaires_internes: string | null;
  commentaire_lieu: string | null;
  siren: string | null;
  email_gestionnaire: string | null;
  reference_citeo: boolean;
  actif: boolean;
}

export default function LieuDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [lieu, setLieu] = useState<Lieu | null>(null);
  const [loading, setLoading] = useState(true);
  const [normalising, setNormalising] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/admin/lieux/${params.id}`)
      .then((r) => r.json())
      .then((d: Lieu) => setLieu(d))
      .catch(() => setError('Erreur chargement'))
      .finally(() => setLoading(false));
  }, [params.id]);

  const handleNormaliser = async () => {
    setNormalising(true);
    const res = await fetch(`/api/v1/admin/lieux/${params.id}/normaliser`, {
      method: 'POST',
    });
    if (res.ok) {
      const updated = (await res.json()) as Lieu;
      setLieu(updated);
    }
    setNormalising(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !lieu) {
    return <p className="text-savr-error-600">{error ?? 'Lieu introuvable'}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <MapPin className="h-5 w-5 text-savr-neutral-600" />
        <h1 className="text-xl font-bold text-savr-neutral-900">{lieu.nom}</h1>
        {lieu.actif ? (
          <Badge variant="success">Actif</Badge>
        ) : (
          <Badge variant="warning">En attente normalisation</Badge>
        )}
        {!lieu.actif && (
          <Button
            size="sm"
            onClick={() => void handleNormaliser()}
            disabled={normalising}
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            {normalising ? 'En cours…' : 'Normaliser'}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Informations générales
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Adresse</dt>
              <dd className="font-medium text-right">
                {lieu.adresse_acces}, {lieu.code_postal} {lieu.ville}
              </dd>
            </div>
            {lieu.region && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Région</dt>
                <dd className="font-medium">{lieu.region}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Véhicule max</dt>
              <dd className="font-medium">{lieu.type_vehicule_max}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Contrôle accès</dt>
              <dd className="font-medium">
                {lieu.controle_acces_requis_default ? 'Oui' : 'Non'}
              </dd>
            </div>
            {lieu.contraintes_horaires && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Horaires</dt>
                <dd className="font-medium">{lieu.contraintes_horaires}</dd>
              </div>
            )}
            {lieu.volume_max_bacs && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Volume max bacs</dt>
                <dd className="font-medium">{lieu.volume_max_bacs}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Accès & logistique
          </h2>
          <dl className="space-y-2 text-sm">
            {lieu.acces_office && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">
                  Difficulté accès office
                </dt>
                <dd className="font-medium">{lieu.acces_office}</dd>
              </div>
            )}
            {lieu.stationnement && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Stationnement</dt>
                <dd className="font-medium">{lieu.stationnement}</dd>
              </div>
            )}
            {lieu.acces_details && (
              <div>
                <dt className="text-savr-neutral-500 mb-1">Détails accès</dt>
                <dd className="text-savr-neutral-700 bg-savr-neutral-50 rounded p-2">
                  {lieu.acces_details}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Champs Admin / Ops
          </h2>
          <dl className="space-y-2 text-sm">
            {lieu.commentaire_lieu && (
              <div>
                <dt className="text-savr-neutral-500 mb-1">Commentaire lieu</dt>
                <dd className="text-savr-neutral-700 bg-savr-neutral-50 rounded p-2">
                  {lieu.commentaire_lieu}
                </dd>
              </div>
            )}
            {lieu.siren && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">SIREN</dt>
                <dd className="font-mono font-medium">{lieu.siren}</dd>
              </div>
            )}
            {lieu.email_gestionnaire && (
              <div className="flex justify-between">
                <dt className="text-savr-neutral-500">Email gestionnaire</dt>
                <dd className="font-medium">{lieu.email_gestionnaire}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-savr-neutral-500">Référence Citeo</dt>
              <dd>
                {lieu.reference_citeo ? (
                  <Badge variant="success">Oui</Badge>
                ) : (
                  <Badge variant="neutral">Non</Badge>
                )}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" asChild>
          <a href={`/admin/lieux/${lieu.id}/modifier`}>Modifier</a>
        </Button>
      </div>
    </div>
  );
}
