'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  PlusCircle,
  CalendarPlus,
  Mail,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

type CollecteRecap = {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  heure_collecte: string | null;
};

type LieuRecap = {
  nom: string | null;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
};

type EvenementRecap = {
  id: string;
  nom_evenement: string;
  pax: number | null;
  contact_principal_nom: string | null;
  // Relation to-one : PostgREST renvoie un objet, on tolère le tableau par sûreté.
  lieux: LieuRecap | LieuRecap[] | null;
  collectes: CollecteRecap[];
};

// Libellés type collecte — tolère l'enum DB (zero_dechet/anti_gaspi) et les
// alias UI (zd/ag) pour être robuste à la forme renvoyée par l'API.
function libelleType(type: string): string {
  if (type === 'anti_gaspi' || type === 'ag') return 'Anti-Gaspi';
  if (type === 'zero_dechet' || type === 'zd') return 'Zéro Déchet';
  return type;
}

function formatDate(date: string | null): string {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

// `heure_collecte` est une colonne `time` (ex. "14:30:00") — on n'affiche que HH:MM
// (même convention que les listes collectes agence/organisateur).
function formatHeure(heure: string | null): string {
  return heure ? heure.slice(0, 5) : '';
}

function formatLieu(lieux: EvenementRecap['lieux']): string {
  const lieu = Array.isArray(lieux) ? (lieux[0] ?? null) : lieux;
  if (!lieu) return '—';
  const adresse = [
    lieu.adresse_acces,
    [lieu.code_postal, lieu.ville].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return [lieu.nom, adresse].filter(Boolean).join(' — ') || '—';
}

function ConfirmationContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');

  const [evenement, setEvenement] = useState<EvenementRecap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || id === 'undefined') {
      setError('Identifiant de l’événement manquant.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/programmation/evenements/${encodeURIComponent(id)}`,
        );
        const data = (await res.json()) as EvenementRecap & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? 'Événement introuvable.');
          return;
        }
        setEvenement(data);
      } catch {
        if (!cancelled) setError('Erreur lors du chargement de l’événement.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <Text>Chargement du récapitulatif…</Text>;
  }

  const collectes = evenement?.collectes ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Bandeau succès */}
      {/* ds-classes: valeur unique (emerald-50 ≠ success-subtle), à arbitrer */}
      <div className="flex items-start gap-3 rounded-savr-lg border border-savr-success bg-emerald-50 px-5 py-4">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-savr-success" />
        <div className="space-y-1">
          <Heading level={1} size="lg">
            {collectes.length > 1
              ? 'Vos collectes sont programmées'
              : 'Votre collecte est programmée'}
          </Heading>
          <Text variant="body">
            {evenement
              ? `Événement « ${evenement.nom_evenement} » enregistré avec succès.`
              : 'Programmation enregistrée avec succès.'}
          </Text>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-savr-md border border-savr-error bg-savr-error-subtle px-3 py-2 text-sm text-savr-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Détails de l'événement — lieu / pax / contact sont portés par
          `evenements` (pas par collecte), cf. §04 Data Model. */}
      {evenement && (
        <div className="space-y-3">
          <Heading level={2} size="sm" tone="faint" overline>
            Événement
          </Heading>
          <dl className="grid gap-4 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-4 py-3 sm:grid-cols-3">
            <div className="space-y-0.5 sm:col-span-3">
              <Text as="dt" variant="hint">
                Lieu
              </Text>
              <Text as="dd" tone="ink">
                {formatLieu(evenement.lieux)}
              </Text>
            </div>
            <div className="space-y-0.5">
              <Text as="dt" variant="hint">
                Nombre de pax
              </Text>
              <Text as="dd" tone="ink">
                {evenement.pax ?? '—'}
              </Text>
            </div>
            <div className="space-y-0.5 sm:col-span-2">
              <Text as="dt" variant="hint">
                Contact principal
              </Text>
              <Text as="dd" tone="ink">
                {evenement.contact_principal_nom || '—'}
              </Text>
            </div>
          </dl>
        </div>
      )}

      {/* Récapitulatif des collectes créées */}
      {collectes.length > 0 && (
        <div className="space-y-3">
          <Heading level={2} size="sm" tone="faint" overline>
            {collectes.length > 1
              ? `${collectes.length} collectes créées`
              : 'Collecte créée'}
          </Heading>
          <ul className="space-y-2">
            {collectes.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-savr-md border border-savr-neutral-200 bg-savr-white px-4 py-3"
              >
                <div className="space-y-0.5">
                  <Text tone="ink" className="font-semibold">
                    {libelleType(c.type)}
                  </Text>
                  <Text variant="hint">
                    {formatDate(c.date_collecte)}
                    {formatHeure(c.heure_collecte)
                      ? ` à ${formatHeure(c.heure_collecte)}`
                      : ''}
                  </Text>
                </div>
                <CollecteStatutBadge statut={c.statut} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Note email récap (§06.01 action post-confirmation §10) */}
      <Text tone="soft" className="flex items-center gap-2">
        <Mail className="h-4 w-4 shrink-0 text-savr-neutral-400" />
        Un email récapitulatif vient de vous être envoyé.
      </Text>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {evenement && (
          <Button asChild>
            <Link href={`/programmer/${evenement.id}/ajouter-collecte`}>
              <PlusCircle />
              Ajouter une collecte à cet événement
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href="/programmer/nouveau">
            <CalendarPlus />
            Programmer un autre événement
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Retour à l&apos;accueil</Link>
        </Button>
      </div>
    </div>
  );
}

export default function ConfirmationProgrammationPage() {
  return (
    <Suspense fallback={<Text>Chargement du récapitulatif…</Text>}>
      <ConfirmationContent />
    </Suspense>
  );
}
