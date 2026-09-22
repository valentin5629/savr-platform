'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { Skeleton } from '@/components/ui/skeleton';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  evenement_nom: string | null;
  lieu_nom: string | null;
}

const Vide = () => <span className="text-savr-neutral-400">—</span>;

function GestionnaireCollectesContent() {
  const router = useRouter();
  const params = useSearchParams();
  // Drill-down depuis les Top listes du dashboard (lieu / traiteur). Miroir exact :
  // le drill-down porte aussi type + période (from/to) + statut `cloturee` pour que
  // le nombre de lignes = le chiffre du Top liste.
  const lieuFiltre = params.get('lieu');
  const traiteurFiltre = params.get('traiteur');
  const typeFiltre = params.get('type');
  const statutFiltre = params.get('statut');
  const fromFiltre = params.get('from');
  const toFiltre = params.get('to');
  const [filtreLabel, setFiltreLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    setLoading(true);
    setErreur(null);
    const qs = new URLSearchParams();
    if (lieuFiltre) qs.set('lieu_id', lieuFiltre);
    if (traiteurFiltre) qs.set('traiteur_id', traiteurFiltre);
    if (typeFiltre) qs.set('type', typeFiltre);
    if (statutFiltre) qs.set('statut', statutFiltre);
    if (fromFiltre) qs.set('from', fromFiltre);
    if (toFiltre) qs.set('to', toFiltre);
    const suffix = qs.toString() ? `?${qs}` : '';
    fetch(`/api/v1/gestionnaire/collectes${suffix}`)
      .then((r) => {
        // Sans cette garde, un 500 rendait `data` absent → liste vide → l'écran
        // affichait « Aucune collecte sur vos lieux » : une panne serveur se
        // lisait comme un parc sans collecte (§10 §7, état Error distinct de
        // l'état Empty).
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .catch(() => setErreur('Le chargement des collectes a échoué.'))
      .finally(() => setLoading(false));
  }, [
    lieuFiltre,
    traiteurFiltre,
    typeFiltre,
    statutFiltre,
    fromFiltre,
    toFiltre,
  ]);

  useEffect(() => {
    charger();
  }, [charger]);

  useEffect(() => {
    if (lieuFiltre) setFiltreLabel(readCollecteFiltreLabel('lieu', lieuFiltre));
    else if (traiteurFiltre)
      setFiltreLabel(readCollecteFiltreLabel('traiteur', traiteurFiltre));
    else setFiltreLabel(null);
  }, [lieuFiltre, traiteurFiltre]);

  function clearFiltre() {
    const usp = new URLSearchParams(Array.from(params.entries()));
    ['lieu', 'traiteur', 'type', 'statut', 'from', 'to'].forEach((k) =>
      usp.delete(k),
    );
    const s = usp.toString();
    router.replace(`/gestionnaire/collectes${s ? `?${s}` : ''}`);
  }

  const chipLabel = lieuFiltre
    ? `Lieu : ${filtreLabel ?? rows[0]?.lieu_nom ?? 'lieu sélectionné'}`
    : traiteurFiltre
      ? `Traiteur : ${filtreLabel ?? 'traiteur sélectionné'}`
      : null;
  const chipScope = (() => {
    const parts: string[] = [];
    if (statutFiltre === 'cloturee') parts.push('clôturées');
    const per = periodeCourte(fromFiltre, toFiltre);
    if (per) parts.push(per);
    return parts.length ? parts.join(' · ') : undefined;
  })();

  const colonnes: Column<CollecteRow>[] = [
    {
      key: 'date_collecte',
      header: 'Date',
      render: (c) =>
        c.date_collecte ? (
          new Date(c.date_collecte).toLocaleDateString('fr-FR', {
            timeZone: 'Europe/Paris',
          })
        ) : (
          <Vide />
        ),
    },
    {
      key: 'lieu_nom',
      header: 'Lieu',
      render: (c) => c.lieu_nom ?? <Vide />,
    },
    {
      key: 'evenement_nom',
      header: 'Événement',
      render: (c) => c.evenement_nom ?? <Vide />,
    },
    {
      key: 'type',
      header: 'Type',
      render: (c) => (
        <Badge variant={c.type === 'zero_dechet' ? 'info' : 'success'}>
          {c.type === 'zero_dechet' ? 'ZD' : 'AG'}
        </Badge>
      ),
    },
    {
      key: 'statut',
      header: 'Statut',
      render: (c) => <CollecteStatutBadge statut={c.statut} />,
    },
  ];

  // États système §10 §7 — Loading = skeleton à la forme du contenu, Error =
  // message + « Réessayer », Empty = EmptyState illustré. Les trois sont
  // distincts : une panne ne doit jamais se lire comme une liste vide.
  const contenu = erreur ? (
    <div className="space-y-4" data-testid="collectes-erreur">
      <AlertBar variant="err">{erreur}</AlertBar>
      <Button variant="secondary" onClick={charger}>
        Réessayer
      </Button>
    </div>
  ) : loading ? (
    <div className="space-y-2" data-testid="collectes-skeleton">
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  ) : rows.length === 0 ? (
    <EmptyState
      icon={<ClipboardList />}
      title="Aucune collecte"
      description="Aucune collecte sur vos lieux pour ce périmètre."
    />
  ) : (
    <DataTable
      columns={colonnes}
      data={rows}
      keyExtractor={(c) => c.id}
      onRowClick={(c) => router.push(`/gestionnaire/collectes/${c.id}`)}
    />
  );

  return (
    <div className="space-y-5">
      <PageHero
        icon={<ClipboardList className="h-6 w-6 text-savr-primary-200" />}
        title="Collectes"
        subtitle="Collectes sur les lieux de votre organisation · cliquez une ligne pour ouvrir la fiche"
      />

      {chipLabel && (
        <CollecteFiltreActif
          label={chipLabel}
          scope={chipScope}
          onClear={clearFiltre}
        />
      )}

      {contenu}
    </div>
  );
}

export default function GestionnaireCollectesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <GestionnaireCollectesContent />
    </Suspense>
  );
}
