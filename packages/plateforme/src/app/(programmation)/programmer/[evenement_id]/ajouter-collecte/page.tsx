'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SousBlocCollecte,
  type CollecteFormData,
} from '@/components/programmation/sous-bloc-collecte';
import { useSignalZdSelection } from '@/components/layout/logo-context';

export default function AjouterCollectePage() {
  const { evenement_id } = useParams<{ evenement_id: string }>();
  const router = useRouter();
  const [type, setType] = useState<'zd' | 'ag'>('zd');
  // Logo Savr vert tant que l'onglet ZD est actif ; orange sur Anti-Gaspi.
  useSignalZdSelection(type === 'zd');
  const [data, setData] = useState<CollecteFormData>({
    type: 'zd',
    date_collecte: '',
    heure_collecte: '',
    informations_supplementaires: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agDoublonConfirm, setAgDoublonConfirm] = useState(false);
  const [agDoublonWarning, setAgDoublonWarning] = useState(false);

  const handleTypeChange = (t: 'zd' | 'ag') => {
    setType(t);
    setData({ ...data, type: t });
    setAgDoublonWarning(false);
    setAgDoublonConfirm(false);
  };

  const valid = data.date_collecte !== '' && data.heure_collecte !== '';

  const handleSubmit = async () => {
    // Vérification doublon AG : détecter si CET événement a déjà une collecte AG
    if (type === 'ag' && !agDoublonConfirm) {
      const check = await fetch(
        `/api/v1/programmation/evenements/${evenement_id}`,
      );
      const evt = (await check.json()) as {
        collectes?: { type: string }[];
      };
      const hasAg = evt.collectes?.some((c) => c.type === 'ag');
      if (hasAg) {
        setAgDoublonWarning(true);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/programmation/evenements/${evenement_id}/collectes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type,
            date_collecte: data.date_collecte,
            heure_collecte: data.heure_collecte,
            informations_supplementaires:
              data.informations_supplementaires || undefined,
          }),
        },
      );
      const result = (await res.json()) as {
        collecte_id?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(result.error ?? 'Erreur');
        return;
      }
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-savr-neutral-900">
        Ajouter une collecte
      </h1>

      <div className="flex gap-3">
        {(['zd', 'ag'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleTypeChange(t)}
            className={`flex-1 rounded-savr-md border-2 py-2 text-sm font-semibold transition-colors ${
              type === t
                ? 'border-savr-primary-700 bg-savr-primary-50 text-savr-primary-700'
                : 'border-savr-neutral-200 text-savr-neutral-600 hover:border-savr-neutral-300'
            }`}
          >
            {t === 'zd' ? 'Zéro Déchet' : 'Anti-Gaspi'}
          </button>
        ))}
      </div>

      <SousBlocCollecte
        type={type}
        data={{ ...data, type }}
        onChange={(updated) => setData(updated)}
      />

      {agDoublonWarning && (
        <div className="rounded-savr-md border border-savr-warning bg-amber-50 px-4 py-3 space-y-3">
          <p className="flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            Cet événement a déjà une collecte Anti-Gaspi. Confirmer l&apos;ajout
            d&apos;une seconde&nbsp;?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setAgDoublonConfirm(true);
                setAgDoublonWarning(false);
                void handleSubmit();
              }}
            >
              Confirmer quand même
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAgDoublonWarning(false)}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-savr-md bg-red-50 border border-savr-error px-3 py-2 text-sm text-savr-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.back()}>
          Annuler
        </Button>
        <Button
          onClick={() => void handleSubmit()}
          disabled={!valid || submitting || agDoublonWarning}
        >
          <CheckCircle className="h-4 w-4" />
          Ajouter la collecte
        </Button>
      </div>
    </div>
  );
}
