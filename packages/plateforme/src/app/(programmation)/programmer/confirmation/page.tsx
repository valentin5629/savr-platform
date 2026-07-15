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

type CollecteRecap = {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
};

type EvenementRecap = {
  id: string;
  nom_evenement: string;
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
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
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
        const res = await fetch(`/api/v1/programmation/evenements/${id}`);
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
    return (
      <p className="text-sm text-savr-neutral-500">
        Chargement du récapitulatif…
      </p>
    );
  }

  const collectes = evenement?.collectes ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Bandeau succès */}
      <div className="flex items-start gap-3 rounded-savr-lg border border-savr-success bg-emerald-50 px-5 py-4">
        <CheckCircle2 className="h-6 w-6 shrink-0 text-savr-success" />
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-savr-neutral-900">
            {collectes.length > 1
              ? 'Vos collectes sont programmées'
              : 'Votre collecte est programmée'}
          </h1>
          <p className="text-sm text-savr-neutral-700">
            {evenement
              ? `Événement « ${evenement.nom_evenement} » enregistré avec succès.`
              : 'Programmation enregistrée avec succès.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-savr-md border border-savr-error bg-red-50 px-3 py-2 text-sm text-savr-error">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Récapitulatif des collectes créées */}
      {collectes.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-savr-neutral-500">
            {collectes.length > 1
              ? `${collectes.length} collectes créées`
              : 'Collecte créée'}
          </h2>
          <ul className="space-y-2">
            {collectes.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-savr-md border border-savr-neutral-200 bg-savr-white px-4 py-3"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-savr-neutral-900">
                    {libelleType(c.type)}
                  </p>
                  <p className="text-xs text-savr-neutral-500">
                    Collecte du {formatDate(c.date_collecte)}
                  </p>
                </div>
                <CollecteStatutBadge statut={c.statut} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Note email récap (§06.01 action post-confirmation §10) */}
      <p className="flex items-center gap-2 text-sm text-savr-neutral-600">
        <Mail className="h-4 w-4 shrink-0 text-savr-neutral-400" />
        Un email récapitulatif vient de vous être envoyé.
      </p>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {evenement && (
          <Button asChild>
            <Link href={`/programmer/${evenement.id}/ajouter-collecte`}>
              <PlusCircle className="h-4 w-4" />
              Ajouter une collecte à cet événement
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href="/programmer/nouveau">
            <CalendarPlus className="h-4 w-4" />
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
    <Suspense
      fallback={
        <p className="text-sm text-savr-neutral-500">
          Chargement du récapitulatif…
        </p>
      }
    >
      <ConfirmationContent />
    </Suspense>
  );
}
