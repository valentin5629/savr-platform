'use client';

import { AlertBar } from '@/components/ui/alert-bar';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import {
  SousBlocCollecte,
  paxSaisiValide,
  type CollecteFormData,
} from '@/components/programmation/sous-bloc-collecte';
import { usePackAg } from '@/components/programmation/use-pack-ag';
import { useSignalZdSelection } from '@/components/layout/logo-context';
import { PageHeader } from '@/components/ui/page-header';
import { FormActions } from '@/components/ui/form-actions';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import { normaliserTypeCollecte } from '@/lib/libelles/type-collecte';

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
    pax: '',
    informations_supplementaires: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agDoublonConfirm, setAgDoublonConfirm] = useState(false);
  const [agDoublonWarning, setAgDoublonWarning] = useState(false);

  // Pack AG de l'organisation de l'événement, celle qui paie : sans pack actif,
  // la collecte AG ajoutée sera facturée à l'unité, information affichée dans le
  // sous-bloc (décision Val 2026-10-16). Le paramètre `organisation_id` n'est
  // honoré que pour le staff ; un rôle client lit toujours son propre pack, qui
  // est celui de l'événement (la route d'ajout l'impose).
  const [orgEvenement, setOrgEvenement] = useState<string | null>(null);
  useEffect(() => {
    let ignore = false;
    fetch(
      `/api/v1/programmation/evenements/${encodeURIComponent(evenement_id)}`,
    )
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{
              organisation_id?: string;
              collectes?: {
                statut?: string | null;
                date_collecte: string | null;
                heure_collecte: string | null;
                pax: number | null;
              }[];
            }>)
          : null,
      )
      .then((evt) => {
        if (ignore) return;
        setOrgEvenement(evt?.organisation_id ?? null);
        // Pax pré-rempli avec celui de la dernière collecte non annulée de
        // l'événement au pax connu (décision Val 2026-10-20 ; même règle que le
        // défaut en base), modifiable ; jamais écrasé s'il est saisi. Un pax
        // à 0 (inconnu, reprise Bubble) ne se pré-remplit pas.
        const derniere = [...(evt?.collectes ?? [])]
          .filter((c) => c.statut !== 'annulee' && c.pax != null && c.pax > 0)
          .sort((a, b) =>
            `${a.date_collecte ?? ''} ${a.heure_collecte ?? ''}`.localeCompare(
              `${b.date_collecte ?? ''} ${b.heure_collecte ?? ''}`,
            ),
          )
          .pop();
        if (derniere?.pax != null)
          setData((d) =>
            d.pax === '' ? { ...d, pax: String(derniere.pax) } : d,
          );
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [evenement_id]);
  const pack = usePackAg(type === 'ag' ? orgEvenement : null);

  const handleTypeChange = (t: 'zd' | 'ag') => {
    setType(t);
    setData({ ...data, type: t });
    setAgDoublonWarning(false);
    setAgDoublonConfirm(false);
  };

  const valid =
    data.date_collecte !== '' &&
    data.heure_collecte !== '' &&
    paxSaisiValide(data.pax);

  // `doublonConfirme` : passé par « Confirmer quand même », dont le clic lirait
  // sinon l'état d'avant la confirmation et rouvrirait l'avertissement.
  const handleSubmit = async (doublonConfirme = agDoublonConfirm) => {
    // Vérification doublon AG : détecter si CET événement a déjà une collecte AG
    if (type === 'ag' && !doublonConfirme) {
      const check = await fetch(
        `/api/v1/programmation/evenements/${encodeURIComponent(evenement_id)}`,
      );
      const evt = (await check.json()) as {
        collectes?: { type: string }[];
      };
      // La route rend l'enum de la base (`anti_gaspi`), pas l'alias du
      // formulaire (`ag`).
      const hasAg = evt.collectes?.some(
        (c) => normaliserTypeCollecte(c.type) === 'anti_gaspi',
      );
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
            pax: Number.parseInt(data.pax, 10),
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
        pack={type === 'ag' ? pack : undefined}
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
                void handleSubmit(true);
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
