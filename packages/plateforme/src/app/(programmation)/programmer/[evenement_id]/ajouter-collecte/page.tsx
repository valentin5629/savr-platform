'use client';

import { AlertBar } from '@/components/ui/alert-bar';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import {
  SousBlocCollecte,
  type CollecteFormData,
} from '@/components/programmation/sous-bloc-collecte';
import { useSignalZdSelection } from '@/components/layout/logo-context';
import { PageHeader } from '@/components/ui/page-header';
import { FormActions } from '@/components/ui/form-actions';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';

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
        `/api/v1/programmation/evenements/${encodeURIComponent(evenement_id)}`,
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
        `/api/v1/programmation/evenements/${encodeURIComponent(evenement_id)}/collectes`,
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
      <PageHeader title="Ajouter une collecte" tone="neutral" size="xl" />

      <ToggleTypeCollecte
        value={type === 'zd' ? 'zero_dechet' : 'anti_gaspi'}
        onChange={(v) => handleTypeChange(v === 'zero_dechet' ? 'zd' : 'ag')}
        className="w-full [&>*]:flex-1"
      />

      <SousBlocCollecte
        type={type}
        data={{ ...data, type }}
        onChange={(updated) => setData(updated)}
      />

      {agDoublonWarning && (
        <div className="space-y-3">
          <AlertBar variant="warn" icon={<AlertTriangle />}>
            Cet événement a déjà une collecte Anti-Gaspi. Confirmer l&apos;ajout
            d&apos;une seconde&nbsp;?
          </AlertBar>
          <FormActions
            cancel={{
              label: 'Annuler',
              size: 'sm',
              onClick: () => setAgDoublonWarning(false),
            }}
            submit={{
              label: 'Confirmer quand même',
              size: 'sm',
              onClick: () => {
                setAgDoublonConfirm(true);
                setAgDoublonWarning(false);
                void handleSubmit();
              },
            }}
          />
        </div>
      )}

      {error && (
        <AlertBar variant="err" role="alert" icon={<AlertTriangle />}>
          {error}
        </AlertBar>
      )}

      <FormActions
        cancel={{ label: 'Annuler', onClick: () => router.back() }}
        submit={{
          label: (
            <>
              <CheckCircle /> Ajouter la collecte
            </>
          ),
          onClick: () => void handleSubmit(),
          disabled: !valid || submitting || agDoublonWarning,
        }}
        className="gap-3"
      />
    </div>
  );
}
