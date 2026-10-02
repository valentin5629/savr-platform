'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
  type SortingState,
} from '@/components/ui/data-grid';
import {
  CelluleLieu,
  ResultatsCollecte,
} from '@/components/collecte/collectes-traiteur-table';
import { TypeCollecteBadge } from '@/components/collecte/type-collecte-badge';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { ListFooter } from '@/components/ui/list-footer';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { Skeleton } from '@/components/ui/skeleton';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal';
import { COLLECTES_PAGE_SIZE as PAGE_SIZE } from '@/lib/collectes-gestionnaire';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';
import { fmtPax } from '@/lib/format';

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  heure_collecte?: string | null;
  evenement_nom: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  client_nom: string | null;
  traiteur_nom: string | null;
  pax: number | null;
  // Résultats de la collecte réalisée (agrégés par la route).
  poids_total_kg: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  nb_repas_donnes: number | null;
}

// Un seul squelette pour les deux moments de chargement de l'écran : le fallback
// du Suspense (résolution de useSearchParams) et l'attente de la réponse.
const SqueletteListe = () => (
  <div className="space-y-2" data-testid="collectes-skeleton">
    {[...Array(5)].map((_, i) => (
      <Skeleton key={i} className="h-12 w-full" />
    ))}
  </div>
);

function GestionnaireCollectesContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [fiche, setFiche] = useState<{ id: string; edit: boolean } | null>(
    () => {
      const id = params.get('collecte');
      return id ? { id, edit: params.get('edit') === '1' } : null;
    },
  );
  // Drill-down depuis les Top listes du dashboard (lieu / traiteur). §06.05 l.209 :
  // « tous statuts, type ZD/AG non figé ; filtres du dashboard propagés (période +
  // Type/Taille d'événement) ». Le dashboard ne fige donc NI `type` NI `statut` —
  // l'écart qui les forçait (règle §06.04 traiteur appliquée par erreur au
  // gestionnaire) est corrigé dans ce lot, côté `drillUrl` du dashboard.
  //
  // `type` / `statut` restent lus et transmis : la route les accepte toujours, et
  // une URL écrite à la main — ou un favori d'avant ce lot — doit filtrer comme
  // elle l'annonce plutôt qu'ignorer en silence les paramètres qu'elle porte.
  const lieuFiltre = params.get('lieu');
  const traiteurFiltre = params.get('traiteur');
  const typeFiltre = params.get('type');
  const statutFiltre = params.get('statut');
  const fromFiltre = params.get('from');
  const toFiltre = params.get('to');
  // Multi-valués (§06.05 l.209). `getAll` rend un TABLEAU NEUF à chaque rendu :
  // placé tel quel dans les dépendances de `charger`, il recréerait le callback à
  // chaque rendu et l'effet partirait en requêtes infinies. On dérive donc une clé
  // TEXTE stable et on reconstruit les tableaux à partir d'elle. Ni un UUID ni un
  // code de bracket (XS…XL) ne contient de virgule : le join/split est réversible.
  const typeEvtKey = params.getAll('type_evenement_ids[]').join(',');
  const tailleKey = params.getAll('taille_evenements[]').join(',');
  const [filtreLabel, setFiltreLabel] = useState<string | null>(null);
  // Tri de la Data Table, envoyé à l'API (liste paginée : trier la seule page
  // chargée donnerait un ordre faux). Défaut = date décroissante, comme la route.
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'date', desc: true },
  ]);
  const tri = sorting[0];
  const triKey = tri ? `${tri.id}:${tri.desc ? 'desc' : 'asc'}` : '';

  // La page courante n'a de sens QUE pour le périmètre qui l'a produite : rester
  // en page 3 après avoir appliqué un filtre qui ne ramène qu'une page afficherait
  // une liste vide sur un parc non vide. On mémorise donc la page AVEC la
  // signature des filtres, et on retombe sur 1 dès que la signature change — au
  // même rendu, donc sans second appel réseau.
  const filtresKey = [
    lieuFiltre,
    traiteurFiltre,
    typeFiltre,
    statutFiltre,
    fromFiltre,
    toFiltre,
    typeEvtKey,
    tailleKey,
    // Changer de tri renvoie aussi en page 1 (la page 3 d'un autre ordre n'a
    // aucun rapport avec celle qu'on regardait).
    triKey,
  ].join('|');
  const [pagination, setPagination] = useState({ key: filtresKey, page: 1 });
  const page = pagination.key === filtresKey ? pagination.page : 1;
  const allerPage = (p: number) => setPagination({ key: filtresKey, page: p });

  // Liste paginée serveur (R-UI-4a) : URL mémoïsée, garde anti-réponse périmée
  // et état Error portés par `useListePaginee`. Sans la garde `!r.ok`, un 500
  // rendait `data` absent → liste vide → « Aucune collecte sur vos lieux » :
  // une panne serveur se lisait comme un parc sans collecte (§10 §7).
  const urlListe = useMemo(() => {
    const qs = new URLSearchParams();
    if (lieuFiltre) qs.set('lieu_id', lieuFiltre);
    if (traiteurFiltre) qs.set('traiteur_id', traiteurFiltre);
    if (typeFiltre) qs.set('type', typeFiltre);
    if (statutFiltre) qs.set('statut', statutFiltre);
    if (fromFiltre) qs.set('from', fromFiltre);
    if (toFiltre) qs.set('to', toFiltre);
    if (typeEvtKey)
      typeEvtKey
        .split(',')
        .forEach((v) => qs.append('type_evenement_ids[]', v));
    if (tailleKey)
      tailleKey.split(',').forEach((v) => qs.append('taille_evenements[]', v));
    if (triKey) {
      const [triId, ordre] = triKey.split(':');
      qs.set('tri', triId!);
      qs.set('ordre', ordre!);
    }
    if (page > 1) qs.set('page', String(page));
    const suffix = qs.toString() ? `?${qs}` : '';
    return `/api/v1/gestionnaire/collectes${suffix}`;
  }, [
    lieuFiltre,
    traiteurFiltre,
    typeFiltre,
    statutFiltre,
    fromFiltre,
    toFiltre,
    typeEvtKey,
    tailleKey,
    triKey,
    page,
  ]);
  const {
    data: rows,
    total,
    loading: chargement,
    erreur,
    recharger: charger,
  } = useListePaginee<CollecteRow>(urlListe, {
    // `total` absent (contrat plus ancien) : on n'invente pas un total plus
    // grand que ce qu'on a reçu, sinon la pagination proposerait des pages vides.
    extraire: (j) => {
      const r = j as { data?: CollecteRow[]; total?: number };
      const data = r.data ?? [];
      return {
        data,
        total: typeof r.total === 'number' ? r.total : data.length,
      };
    },
    messageErreur: 'Le chargement des collectes a échoué.',
  });

  // Page devenue hors bornes — la liste a rétréci pendant qu'on la consultait
  // (une collecte annulée ailleurs, un parc réduit). Le serveur répond alors
  // une page vide AVEC le vrai total. Sans ce rattrapage, l'écran afficherait
  // « Aucune collecte sur vos lieux pour ce périmètre. » — mot pour mot ce qu'il
  // affiche pour un parc réellement vide — et SANS pagination pour en sortir.
  // `page > dernierePage` est une comparaison STRICTE : on ne redescend que
  // vers une page plus petite, donc jamais de boucle. L'écran reste en
  // chargement pendant la redirection (pas de clignotement de l'état vide).
  const dernierePage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const redirige =
    !chargement &&
    !erreur &&
    rows.length === 0 &&
    total > 0 &&
    page > dernierePage;
  useEffect(() => {
    if (redirige) allerPage(dernierePage);
    // allerPage change à chaque rendu (filtresKey) : la condition seule compte.
  }, [redirige, dernierePage]);
  const loading = chargement || redirige;

  useEffect(() => {
    if (lieuFiltre) setFiltreLabel(readCollecteFiltreLabel('lieu', lieuFiltre));
    else if (traiteurFiltre)
      setFiltreLabel(readCollecteFiltreLabel('traiteur', traiteurFiltre));
    else setFiltreLabel(null);
  }, [lieuFiltre, traiteurFiltre]);

  // Fiche collecte en pop-up (refonte Val 2026-09-29, pop-up client commun) :
  // ouverte depuis l'URL (?collecte=<id>[&edit=1]) → l'ancienne route [id], les
  // emails, le détail événement et les dashboards rouvrent la fiche. `edit`
  // n'est jamais réécrit : un rechargement rouvre la fiche en lecture.
  function majUrlFiche(f: { id: string } | null) {
    const usp = new URLSearchParams(Array.from(params.entries()));
    usp.delete('edit');
    if (f) usp.set('collecte', f.id);
    else usp.delete('collecte');
    const s = usp.toString();
    router.replace(`/gestionnaire/collectes${s ? `?${s}` : ''}`);
  }
  function ouvrirFiche(id: string) {
    const f = { id, edit: false };
    setFiche(f);
    majUrlFiche(f);
  }
  // Une action dans la fiche (édition) peut changer la liste : rechargée à la
  // fermeture.
  function fermerFiche() {
    setFiche(null);
    majUrlFiche(null);
    charger();
  }

  function clearFiltre() {
    const usp = new URLSearchParams(Array.from(params.entries()));
    [
      'lieu',
      'traiteur',
      'type',
      'statut',
      'from',
      'to',
      // Sans ces deux-là, « Retirer le filtre » laissait la liste filtrée sur des
      // critères que plus rien n'affiche : un cul-de-sac silencieux.
      'type_evenement_ids[]',
      'taille_evenements[]',
    ].forEach((k) => usp.delete(k));
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
    // Type/Taille d'événement viennent des filtres globaux du dashboard (§06.05
    // l.209) et n'ont aucun contrôle sur cet écran. Sans cette mention, la liste
    // serait restreinte par des critères invisibles : le gestionnaire chercherait
    // des collectes qu'il voit au dashboard et que cette liste écarte.
    const nbType = typeEvtKey ? typeEvtKey.split(',').length : 0;
    const nbTaille = tailleKey ? tailleKey.split(',').length : 0;
    if (nbType > 0)
      parts.push(`${nbType} type${nbType > 1 ? 's' : ''} d'événement`);
    if (nbTaille > 0)
      parts.push(`${nbTaille} taille${nbTaille > 1 ? 's' : ''} d'événement`);
    return parts.length ? parts.join(' · ') : undefined;
  })();

  // Téléchargement du rapport de la collecte réalisée (ZD = rapport recyclage,
  // AG = attestation de don) — miroir de la liste traiteur : URL R2 pré-signée,
  // no-op silencieux si indisponible (embargo H+24, PDF non encore généré).
  async function telechargerRapport(collecteId: string) {
    try {
      const res = await fetch(
        `/api/v1/gestionnaire/collectes/${encodeURIComponent(collecteId)}/rapport-rse/download`,
      );
      if (!res.ok) return;
      const { url } = (await res.json()) as { url?: string };
      if (url) window.open(url, '_blank');
    } catch {
      // Réseau indisponible : no-op silencieux (l'action reste réessayable).
    }
  }

  // Mêmes colonnes que la liste traiteur (collectes-traiteur-table.tsx), plus
  // « Traiteur » ; « Type » est gardé (liste plate, ZD et AG mêlés) et il n'y a
  // pas de pictos d'action (décisions Val 2026-10-01). Seules Date / Type /
  // Statut sont triables : la liste est paginée côté serveur, `tri` n'ordonne
  // que sur les colonnes de `collectes`, et l'`id` d'une colonne triable est la
  // valeur du paramètre API `tri`.
  const colonnes: ColumnDef<CollecteRow, unknown>[] = [
    {
      id: 'date',
      header: 'Date',
      enableHiding: false,
      accessorFn: (c) => c.date_collecte ?? '',
      cell: ({ row: { original: c } }) =>
        c.date_collecte ? (
          <span className="whitespace-nowrap font-semibold text-savr-neutral-900 tabular-nums">
            {libelleDateHeure(c.date_collecte, c.heure_collecte ?? null)}
          </span>
        ) : (
          <CelluleVide />
        ),
    },
    {
      id: 'lieu',
      header: 'Lieu',
      cell: ({ row: { original: c } }) => (
        <CelluleLieu nom={c.lieu_nom} adresse={c.lieu_adresse} />
      ),
    },
    {
      id: 'client',
      header: 'Client',
      cell: ({ row: { original: c } }) => c.client_nom || <CelluleVide />,
    },
    {
      id: 'traiteur',
      header: 'Traiteur',
      cell: ({ row: { original: c } }) => c.traiteur_nom || <CelluleVide />,
    },
    {
      id: 'pax',
      header: 'Pax',
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: c } }) =>
        c.pax != null ? fmtPax(c.pax) : <CelluleVide />,
    },
    {
      id: 'resultats',
      header: 'Résultats',
      cell: ({ row: { original: c } }) => (
        <ResultatsCollecte
          // Le gestionnaire est servi de tous les rapports des collectes tenues
          // sur ses lieux (§06.05) : jamais « réservé au donneur d'ordre ».
          c={{ ...c, rapport_reserve_donneur_ordre: false }}
          onTelecharger={() => void telechargerRapport(c.id)}
        />
      ),
    },
    {
      id: 'type',
      header: 'Type',
      accessorFn: (c) => c.type,
      cell: ({ row: { original: c } }) => <TypeCollecteBadge type={c.type} />,
    },
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (c) => c.statut,
      cell: ({ row: { original: c } }) => (
        <CollecteStatutBadge statut={c.statut} />
      ),
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
    <SqueletteListe />
  ) : rows.length === 0 ? (
    <EmptyState
      icon={<ClipboardList />}
      title="Aucune collecte"
      description="Aucune collecte sur vos lieux pour ce périmètre."
    />
  ) : (
    <>
      <DataGrid
        data-testid="collectes-table"
        columns={colonnes}
        data={rows}
        getRowId={(c) => c.id}
        manualSorting
        sorting={sorting}
        onSortingChange={setSorting}
        onRowClick={(c) => ouvrirFiche(c.id)}
        rowLabel={(c) =>
          `Ouvrir la collecte${c.evenement_nom ? ` ${c.evenement_nom}` : ''}${c.lieu_nom ? ` — ${c.lieu_nom}` : ''}`
        }
      />
      {total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm">
          <span className="text-savr-neutral-500" data-testid="collectes-total">
            {total} collectes
          </span>
          <ListFooter
            total={total}
            page={page}
            onPageChange={allerPage}
            taillePage={PAGE_SIZE}
            className="pt-0"
          />
        </div>
      )}
    </>
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

      <FicheCollecteClientModal
        espace="gestionnaire"
        collecteId={fiche?.id ?? null}
        initialEditing={fiche?.edit ?? false}
        onClose={fermerFiche}
      />
    </div>
  );
}

export default function GestionnaireCollectesPage() {
  return (
    <Suspense fallback={<SqueletteListe />}>
      <GestionnaireCollectesContent />
    </Suspense>
  );
}
