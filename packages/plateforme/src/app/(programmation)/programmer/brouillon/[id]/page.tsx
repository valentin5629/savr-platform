'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle, AlertTriangle, CalendarDays, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

interface BrouillonDetail {
  id: string;
  nom_evenement: string | null;
  nom_client_organisateur: string | null;
  collectes: {
    id: string;
    type: string;
    statut: string;
    date_collecte: string;
  }[];
}

export default function RepriseBrouillonPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [evt, setEvt] = useState<BrouillonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/v1/programmation/evenements/${encodeURIComponent(id)}`)
      .then((r) => r.json() as Promise<BrouillonDetail>)
      .then((d) => setEvt(d))
      .catch(() => setError('Impossible de charger ce brouillon.'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleConfirmer = async () => {
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/programmation/evenements/${encodeURIComponent(id)}/confirmer`,
        { method: 'PATCH' },
      );
      const json = (await res.json()) as { statut?: string; error?: string };
      if (!res.ok) {
        setError(json.error ?? 'Erreur lors de la confirmation');
        return;
      }
      router.push('/brouillons');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full rounded-savr-lg" />
        <Skeleton className="h-10 w-32" />
      </div>
    );
  }

  if (!evt) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <p className="text-savr-error">{error ?? 'Brouillon introuvable.'}</p>
        <Button variant="secondary" onClick={() => router.push('/brouillons')}>
          Retour aux brouillons
        </Button>
      </div>
    );
  }

  const brouillons = evt.collectes.filter((c) => c.statut === 'brouillon');

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Heading level={1} size="xl">
        Confirmer le brouillon
      </Heading>

      <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-5 space-y-3">
        <p className="font-medium text-savr-neutral-900">
          {evt.nom_client_organisateur ?? evt.nom_evenement ?? 'Sans nom'}
        </p>
        <ul className="space-y-2">
          {brouillons.map((c) => (
            <Text
              as="li"
              variant="body"
              className="flex items-center gap-3"
              key={c.id}
            >
              <CalendarDays className="h-4 w-4 shrink-0 text-savr-neutral-400" />
              <span className="uppercase font-medium text-xs text-savr-neutral-500 w-6">
                {c.type}
              </span>
              {c.date_collecte}
            </Text>
          ))}
        </ul>
        {brouillons.length === 0 && (
          <Text className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Aucune collecte en brouillon à confirmer.
          </Text>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-savr-md bg-savr-error-subtle border border-savr-error px-3 py-2 text-sm text-savr-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={() => void handleConfirmer()}
          disabled={brouillons.length === 0}
          loading={confirming}
          loadingText="Confirmation…"
        >
          <CheckCircle /> Confirmer la programmation
        </Button>
        <Button variant="secondary" onClick={() => router.push('/brouillons')}>
          Annuler
        </Button>
      </div>
    </div>
  );
}
