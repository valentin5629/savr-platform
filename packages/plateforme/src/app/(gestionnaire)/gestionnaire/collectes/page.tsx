'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { Pagination } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import { COLLECTES_PAGE_SIZE as PAGE_SIZE } from '@/lib/collectes-gestionnaire';
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
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

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
  ].join('|');
  const [pagination, setPagination] = useState({ key: filtresKey, page: 1 });
  const page = pagination.key === filtresKey ? pagination.page : 1;
  const allerPage = (p: number) => setPagination({ key: filtresKey, page: p });

  // Chaque appel prend un numéro ; seule la réponse du dernier appel a le droit
  // d'écrire dans l'état. Sans cette garde, un filtre retiré pendant qu'une
  // requête est en vol laisse l'échec de la requête PÉRIMÉE épingler l'écran sur
  // « Le chargement des collectes a échoué. » alors que les données fraîches sont
  // déjà chargées et invisibles (la branche `erreur` l'emporte sur le contenu).
  const generation = useRef(0);

  const charger = useCallback(() => {
    const gen = ++generation.current;
    const perime = () => generation.current !== gen;
    // Voir plus bas : une page devenue hors bornes relance un chargement, et
    // l'écran ne doit pas repasser par l'état « chargé » entre les deux.
    let redirige = false;
    setLoading(true);
    setErreur(null);
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
    if (page > 1) qs.set('page', String(page));
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
      .then((j) => {
        if (perime()) return;
        const data = (j.data ?? []) as CollecteRow[];
        // `total` absent (contrat plus ancien) : on n'invente pas un total plus
        // grand que ce qu'on a reçu, sinon la pagination proposerait des pages
        // vides.
        const recu = typeof j.total === 'number' ? j.total : data.length;

        // Page devenue hors bornes — la liste a rétréci pendant qu'on la
        // consultait (une collecte annulée ailleurs, un parc réduit). Le serveur
        // répond alors une page vide AVEC le vrai total.
        //
        // Sans ce rattrapage, l'écran afficherait « Aucune collecte sur vos
        // lieux pour ce périmètre. » — mot pour mot ce qu'il affiche pour un
        // parc réellement vide — et SANS pagination pour en sortir, puisque le
        // bloc de pagination vit dans la branche non-vide du rendu. L'utilisateur
        // serait dans un cul-de-sac, à devoir recharger l'écran à la main.
        //
        // `page > dernierePage` est une comparaison STRICTE : on ne redescend
        // que vers une page plus petite, donc jamais de boucle.
        const dernierePage = Math.max(1, Math.ceil(recu / PAGE_SIZE));
        if (data.length === 0 && recu > 0 && page > dernierePage) {
          redirige = true;
          allerPage(dernierePage);
          return;
        }

        setRows(data);
        setTotal(recu);
      })
      .catch(() => {
        if (!perime()) setErreur('Le chargement des collectes a échoué.');
      })
      .finally(() => {
        // Pendant une redirection, l'écran reste en chargement : le baisser ici
        // ferait clignoter l'état vide avant l'arrivée de la bonne page.
        if (!perime() && !redirige) setLoading(false);
      });
  }, [
    lieuFiltre,
    traiteurFiltre,
    typeFiltre,
    statutFiltre,
    fromFiltre,
    toFiltre,
    typeEvtKey,
    tailleKey,
    page,
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
    <SqueletteListe />
  ) : rows.length === 0 ? (
    <EmptyState
      icon={<ClipboardList />}
      title="Aucune collecte"
      description="Aucune collecte sur vos lieux pour ce périmètre."
    />
  ) : (
    <>
      <DataTable
        columns={colonnes}
        data={rows}
        keyExtractor={(c) => c.id}
        onRowClick={(c) => router.push(`/gestionnaire/collectes/${c.id}`)}
      />
      {total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-sm">
          <span className="text-savr-neutral-500" data-testid="collectes-total">
            {total} collectes
          </span>
          <Pagination
            page={page}
            pageCount={Math.ceil(total / PAGE_SIZE)}
            onPageChange={allerPage}
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
