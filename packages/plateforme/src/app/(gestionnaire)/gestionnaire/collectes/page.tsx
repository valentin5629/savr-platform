'use client';

import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/loading-state';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { Combobox } from '@/components/ui/combobox';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
  type SortingState,
} from '@/components/ui/data-grid';
import { FiltreCoches } from '@/components/ui/filtre-en-ligne';
import {
  CelluleLieu,
  ResultatsCollecte,
} from '@/components/collecte/collectes-traiteur-table';
import {
  CollecteFiltresBar,
  FILTRES_COLLECTE_VIDES,
  type CollecteFiltresOptions,
} from '@/components/collecte/collecte-filtres-bar';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import { TypeCollecteBadge } from '@/components/collecte/type-collecte-badge';
import { TAILLE_OPTIONS } from '@/components/dashboards/taille-options';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { ListFooter } from '@/components/ui/list-footer';
import {
  entier,
  liste,
  navigation,
  texte,
  useFiltresUrl,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal';
import { COLLECTES_PAGE_SIZE as PAGE_SIZE } from '@/lib/collectes-gestionnaire';
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

/** Options de la barre (route `/gestionnaire/filtres`, même source que le dashboard et la liste Événements). */
interface OptionsFiltres {
  lieux: { id: string; nom: string }[];
  traiteurs: { id: string; nom: string }[];
  types: { id: string; libelle: string }[];
}
const OPTIONS_VIDES: OptionsFiltres = { lieux: [], traiteurs: [], types: [] };
// Les filtres standards de `CollecteFiltresBar` sont masqués (route à valeur
// unique, cf. FILTRES ci-dessous) : la barre ne lit donc jamais ces options.
const OPTIONS_BARRE: CollecteFiltresOptions = {
  lieux: [],
  clients: [],
  programmateurs: [],
};

// Filtres de la liste, miroir de l'URL (R-UI-4b, D6/D10) — mêmes clés que le
// drill-down du dashboard (`lieu`, `traiteur`, `from`, `to`). La route
// `gestionnaire/collectes` n'accepte qu'UNE valeur pour `type`, `statut`,
// `lieu_id` et `traiteur_id` : Lieu et Traiteur sont donc des choix uniques
// (Combobox), Type un segmenté levable (« Toutes »), et il n'y a ni onglets
// Programmées / Historique ni filtre Statut (ils demandent une liste de
// statuts) — reliquat route. `statut` reste lu et transmis : une URL écrite à
// la main doit filtrer comme elle l'annonce. Type / Taille d'événement
// (§06.05 l.209) sont en CSV dans l'URL ; les liens `x[]` (dashboard,
// favoris) restent lus, cf. `lireHeritageCrochets`.
const FILTRES = {
  lieu: texte(),
  traiteur: texte(),
  type: texte(),
  statut: texte(),
  from: texte(),
  to: texte(),
  type_evenement_ids: liste(),
  taille_evenements: liste(),
  // Tri de la Data Table, envoyé à l'API (liste paginée : trier la seule page
  // chargée donnerait un ordre faux). Défaut = date décroissante, comme la route.
  tri: navigation(texte('date')),
  ordre: navigation(texte('desc')),
  page: navigation(entier(1, 1)),
};

const CLES_CROCHETS = ['type_evenement_ids[]', 'taille_evenements[]'] as const;
interface HeritageCrochets {
  type_evenement_ids: string[];
  taille_evenements: string[];
}
const HERITAGE_VIDE: HeritageCrochets = {
  type_evenement_ids: [],
  taille_evenements: [],
};
/** Ancienne convention `x[]` (paramètre répété) : lue au montage, jamais écrite. */
function lireHeritageCrochets(
  params: URLSearchParams | null,
): HeritageCrochets {
  return {
    type_evenement_ids: params?.getAll('type_evenement_ids[]') ?? [],
    taille_evenements: params?.getAll('taille_evenements[]') ?? [],
  };
}
/** Retire les clés `x[]` de l'URL courante : l'état CSV prend le relais. */
function purgerCrochets(): void {
  if (typeof window === 'undefined') return;
  const usp = new URLSearchParams(window.location.search);
  for (const k of CLES_CROCHETS) usp.delete(k);
  const qs = usp.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
  );
}

// Un seul squelette pour les deux moments de chargement de l'écran : le fallback
// du Suspense (résolution de useSearchParams) et l'attente de la réponse.
const SqueletteListe = () => (
  <LoadingState variant="bloc" lignes={5} data-testid="collectes-skeleton" />
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
  const {
    valeurs: f,
    set,
    reset,
    actif: filtresActifs,
  } = useFiltresUrl(FILTRES);
  // Liens `x[]` d'avant ce lot : appliqués tels quels tant que l'utilisateur ne
  // touche pas à la barre ; au premier changement (ou reset) ils basculent en
  // CSV dans l'URL et les clés `x[]` sont retirées.
  const [heritage, setHeritage] = useState<HeritageCrochets>(() =>
    lireHeritageCrochets(params),
  );
  const heritageActif =
    heritage.type_evenement_ids.length > 0 ||
    heritage.taille_evenements.length > 0;
  const typeEvtIds =
    f.type_evenement_ids.length > 0
      ? f.type_evenement_ids
      : heritage.type_evenement_ids;
  const tailles =
    f.taille_evenements.length > 0
      ? f.taille_evenements
      : heritage.taille_evenements;
  const actif = filtresActifs || heritageActif;

  function poser(patch: Partial<typeof f>) {
    if (heritageActif) {
      purgerCrochets();
      setHeritage(HERITAGE_VIDE);
      set({
        type_evenement_ids: typeEvtIds,
        taille_evenements: tailles,
        ...patch,
      });
    } else {
      set(patch);
    }
  }
  function reinitialiser() {
    if (heritageActif) {
      purgerCrochets();
      setHeritage(HERITAGE_VIDE);
    }
    reset();
  }

  const page = f.page;
  const allerPage = (p: number) => set({ page: p });
  const sorting: SortingState = [{ id: f.tri, desc: f.ordre === 'desc' }];

  // Liste paginée serveur (R-UI-4a) : URL mémoïsée, garde anti-réponse périmée
  // et état Error portés par `useListePaginee`. Sans la garde `!r.ok`, un 500
  // rendait `data` absent → liste vide → « Aucune collecte sur vos lieux » :
  // une panne serveur se lisait comme un parc sans collecte (§10 §7).
  const urlListe = useMemo(() => {
    const qs = new URLSearchParams();
    if (f.lieu) qs.set('lieu_id', f.lieu);
    if (f.traiteur) qs.set('traiteur_id', f.traiteur);
    if (f.type) qs.set('type', f.type);
    if (f.statut) qs.set('statut', f.statut);
    if (f.from) qs.set('from', f.from);
    if (f.to) qs.set('to', f.to);
    // La route lit ces deux filtres en paramètre RÉPÉTÉ (`getAll('x[]')`), pas
    // en CSV : l'appel est construit en `x[]` depuis l'état CSV.
    typeEvtIds.forEach((v) => qs.append('type_evenement_ids[]', v));
    tailles.forEach((v) => qs.append('taille_evenements[]', v));
    qs.set('tri', f.tri);
    qs.set('ordre', f.ordre);
    if (page > 1) qs.set('page', String(page));
    return `/api/v1/gestionnaire/collectes?${qs}`;
  }, [
    f.lieu,
    f.traiteur,
    f.type,
    f.statut,
    f.from,
    f.to,
    f.tri,
    f.ordre,
    typeEvtIds,
    tailles,
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

  // Options des filtres (lieux / traiteurs / types d'événement) — périmètre du
  // parc, chargées une fois, après la liste (elle seule compte pour l'écran).
  const [options, setOptions] = useState<OptionsFiltres>(OPTIONS_VIDES);
  useEffect(() => {
    fetch('/api/v1/gestionnaire/filtres')
      .then((r) => r.json())
      .then((j: { data?: Partial<OptionsFiltres> }) => {
        if (j?.data)
          setOptions({
            lieux: j.data.lieux ?? [],
            traiteurs: j.data.traiteurs ?? [],
            types: j.data.types ?? [],
          });
      })
      .catch(() => {
        /* options indisponibles : la barre reste utilisable (listes vides). */
      });
  }, []);

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
  // `enRedirection` couvre le rendu intermédiaire (page corrigée, hook pas
  // encore relancé) : l'écran reste en chargement jusqu'au prochain appel, puis
  // conclut (état vide si la réponse est encore vide — jamais un squelette qui
  // ne finit pas).
  const [enRedirection, setEnRedirection] = useState(false);
  useEffect(() => {
    if (redirige) {
      setEnRedirection(true);
      allerPage(dernierePage);
    }
    // allerPage dépend de `set` (stable) : la condition seule compte.
  }, [redirige, dernierePage]);
  useEffect(() => {
    if (chargement) setEnRedirection(false);
  }, [chargement]);
  const loading = chargement || redirige || enRedirection;

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
    <ErrorState
      data-testid="collectes-erreur"
      message={erreur}
      onRetry={charger}
    />
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
        onSortingChange={(u) => {
          const suivant = typeof u === 'function' ? u(sorting) : u;
          const t = suivant[0];
          // Tri retiré (cycle TanStack) = tri par défaut de la route. Changer
          // de tri renvoie aussi en page 1 (`set` sans `page`).
          set(
            t
              ? { tri: t.id, ordre: t.desc ? 'desc' : 'asc' }
              : { tri: 'date', ordre: 'desc' },
          );
        }}
        onRowClick={(c) => ouvrirFiche(c.id)}
        rowLabel={(c) =>
          `Ouvrir la collecte${c.evenement_nom ? ` ${c.evenement_nom}` : ''}${c.lieu_nom ? ` — ${c.lieu_nom}` : ''}`
        }
      />
      {/* Le compteur vit dans la barre de filtres (D5), le pied ne porte que
          la pagination. */}
      <ListFooter
        total={total}
        page={page}
        onPageChange={allerPage}
        taillePage={PAGE_SIZE}
      />
    </>
  );

  return (
    <div className="space-y-5">
      <PageHero
        icon={<ClipboardList className="h-6 w-6 text-savr-primary-200" />}
        title="Collectes"
        subtitle="Collectes sur les lieux de votre organisation · cliquez une ligne pour ouvrir la fiche"
      />

      {/* Barre de filtres DS (D10 : la même que traiteur / agence) : type
          ZD / AG levable en en-tête, puis Période · Lieu · Traiteur · Type et
          Taille d'événement (§06.05 l.209), compteur et réinitialisation en
          pied. Sans onglets Programmées / Historique ni filtre Statut : la
          route n'accepte qu'un statut (cf. FILTRES). */}
      <CollecteFiltresBar
        toggle={
          <ToggleTypeCollecte
            avecTous
            value={
              f.type === 'zero_dechet' || f.type === 'anti_gaspi'
                ? f.type
                : 'tous'
            }
            onChange={(t) => poser({ type: t === 'tous' ? '' : t })}
          />
        }
        statutsOnglet={[]}
        filtres={{
          statut: false,
          lieu: false,
          client: false,
          infoIncomplete: false,
          programmeePar: false,
        }}
        options={OPTIONS_BARRE}
        value={{ ...FILTRES_COLLECTE_VIDES, from: f.from, to: f.to }}
        onChange={(v) => poser({ from: v.from, to: v.to })}
        actif={actif}
        onReset={reinitialiser}
        resultats={total}
      >
        {/* Choix uniques (route à valeur unique) : Combobox en mode filtre. */}
        <Combobox
          titre="Lieu"
          icon={null}
          data-testid="filtre-lieu"
          options={[
            { value: '', label: 'Tous' },
            ...options.lieux.map((l) => ({ value: l.id, label: l.nom })),
          ]}
          value={f.lieu}
          onChange={(v) => poser({ lieu: v })}
        />
        <Combobox
          titre="Traiteur"
          icon={null}
          data-testid="filtre-traiteur"
          options={[
            { value: '', label: 'Tous' },
            ...options.traiteurs.map((t) => ({ value: t.id, label: t.nom })),
          ]}
          value={f.traiteur}
          onChange={(v) => poser({ traiteur: v })}
        />
        <FiltreCoches
          label="Type d'événement"
          testid="filtre-type-evenement"
          options={options.types.map((t) => ({ id: t.id, nom: t.libelle }))}
          selected={typeEvtIds}
          onChange={(ids) => poser({ type_evenement_ids: ids })}
        />
        <FiltreCoches
          label="Taille d'événement"
          testid="filtre-taille-evenement"
          options={TAILLE_OPTIONS}
          selected={tailles}
          onChange={(ids) => poser({ taille_evenements: ids })}
        />
      </CollecteFiltresBar>

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
