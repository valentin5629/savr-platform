'use client';

import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/loading-state';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarDotsIcon } from '@/components/ui/icones';
import { Badge } from '@/components/ui/badge';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
  type SortingState,
} from '@/components/ui/data-grid';
import { BoutonExportCsv } from '@/components/ui/bouton-export-csv';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches } from '@/components/ui/filtre-en-ligne';
import { ListFooter } from '@/components/ui/list-footer';
import { PageHero } from '@/components/ui/page-hero';
import { Text } from '@/components/ui/text';
import { CelluleLieu } from '@/components/collecte/collectes-traiteur-table';
import { ChevronLigne, RepereJour } from '@/components/collecte/repere-jour';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import {
  LIBELLES_EVENEMENTS,
  OngletsVueCollectes,
} from '@/components/collecte/onglets-vue-collectes';
import { FicheEvenementModal } from '@/components/evenements/fiche-evenement-modal';
import { ResultatsEvenement } from '@/components/gestionnaire/resultats-evenement';
import { TAILLE_OPTIONS } from '@/components/dashboards/taille-options';
import { EVENEMENTS_PAGE_SIZE as PAGE_SIZE } from '@/lib/evenements-gestionnaire';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { fmtKg, fmtPax } from '@/lib/format';
import {
  entier,
  liste,
  navigation,
  texte,
  useFiltresUrl,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { variantStatutEvenement } from '@/lib/libelles/evenement';
import {
  lireVueCollectes,
  periodeDeLaVue,
  triDateDescendant,
} from '@/lib/collectes/vue-temporelle';
import { jourParis } from '@savr/shared/src/temps/index.js';
import type {
  EspaceEvenements as EspaceListeEvenements,
  LigneEvenement,
} from '@/lib/evenements/liste-evenements';
import type { OptionsFiltresEvenements } from '@/lib/evenements/filtres-evenements';

type EvenementRow = LigneEvenement;

const OPTIONS_VIDES: OptionsFiltresEvenements = {
  lieux: [],
  traiteurs: [],
  clients: [],
  types: [],
};

interface ReglageEspace {
  sousTitre: string;
  vide: string;
  /** Colonne et filtre « Traiteur » : masqués au traiteur (c'est toujours lui). */
  traiteur: boolean;
  /** Filtre « Client » (organisation programmatrice) : staff seul. */
  client: boolean;
  /** « Déchets labo est. » : gestionnaire seul (§05 R_dechets_labo_estimes). */
  labo: boolean;
}

// Réglages par espace (décisions Val 2026-10-29) : tout le reste de la page est
// commun, et toute modification de la liste s'applique à tous les rôles.
const REGLAGES: Record<EspaceListeEvenements, ReglageEspace> = {
  admin: {
    sousTitre: 'Tous les événements, résultats cumulés sur leurs collectes',
    vide: 'Aucun événement pour ce périmètre.',
    traiteur: true,
    client: true,
    labo: false,
  },
  traiteur: {
    sousTitre: 'Vos événements, résultats cumulés sur leurs collectes',
    vide: 'Aucun événement pour ce périmètre.',
    traiteur: false,
    client: false,
    labo: false,
  },
  agence: {
    sousTitre:
      'Événements que vous avez programmés, résultats cumulés sur leurs collectes',
    vide: 'Aucun événement pour ce périmètre.',
    traiteur: true,
    client: false,
    labo: false,
  },
  gestionnaire: {
    sousTitre:
      'Événements tenus sur vos lieux, résultats cumulés sur leurs collectes',
    vide: 'Aucun événement sur vos lieux pour ce périmètre.',
    traiteur: true,
    client: false,
    labo: true,
  },
  organisateur: {
    sousTitre: 'Vos événements, résultats cumulés sur leurs collectes',
    vide: 'Aucun événement pour ce périmètre.',
    traiteur: true,
    client: false,
    labo: false,
  },
};

// Filtres de la liste, miroir de l'URL : les clés et la barre de la liste
// Collectes (type ZD / AG levable, Période · Lieu · Traiteur · Type et Taille
// d'événement, tous à choix multiple), pour que les deux listes du gestionnaire
// se lisent pareil. La période porte ici sur la date de l'événement. Pas de
// filtre « Statut consolidé » (arbitrage C3 du 2026-10-07, non repris).
// Vues « Événements à venir / passés » (`onglet`, décision Val 2026-10-20) :
// même règle que la liste Collectes, sur la date de l'événement ; un événement
// sans date (brouillon) n'est dans aucune des deux.
const FILTRES = {
  onglet: navigation(texte('')),
  type: texte(),
  from: texte(),
  to: texte(),
  lieu: liste(),
  traiteur: liste(),
  client: liste(),
  type_evenement_ids: liste(),
  taille_evenements: liste(),
  // `ordre` vide = celui de la vue : le plus proche d'aujourd'hui d'abord.
  ordre: navigation(texte('')),
  page: navigation(entier(1, 1)),
};

const SqueletteListe = () => (
  <LoadingState variant="bloc" lignes={5} data-testid="evenements-skeleton" />
);

/** « 2 ZD · 1 AG » : nombre de collectes de l'événement, par type. */
function libelleCollectes(
  e: Pick<EvenementRow, 'nb_collectes_zd' | 'nb_collectes_ag'>,
) {
  const parts = [
    e.nb_collectes_zd > 0 ? `${e.nb_collectes_zd} ZD` : null,
    e.nb_collectes_ag > 0 ? `${e.nb_collectes_ag} AG` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// Colonnes (§06.05 §2 « Vue liste »), au format de la liste Collectes. Seule la
// date est triable : les autres colonnes sont des cumuls calculés par la route
// sur la page servie. `aujourdhui` (jour de Paris) pose le repère
// « Aujourd’hui » / « Demain » (revue écran 2026-10-29).
const colonnesEvenements = (
  aujourdhui: string,
  reglage: ReglageEspace,
): ColumnDef<EvenementRow, unknown>[] => [
  {
    id: 'date',
    header: 'Date',
    enableHiding: false,
    accessorFn: (e) => e.date_evenement ?? '',
    cell: ({ row: { original: e } }) =>
      e.date_evenement ? (
        <span className="inline-flex items-center gap-2 whitespace-nowrap font-semibold text-savr-neutral-900 tabular-nums">
          {libelleDateHeure(e.date_evenement, null)}
          <RepereJour
            date={e.date_evenement}
            aujourdhui={aujourdhui}
            masque={e.statut_consolide === 'Annulé'}
          />
        </span>
      ) : (
        <CelluleVide />
      ),
  },
  {
    id: 'evenement',
    header: 'Événement',
    enableSorting: false,
    cell: ({ row: { original: e } }) => (
      <div className="min-w-0">
        <div className="font-medium">{e.nom_evenement || '—'}</div>
        {e.client_nom && (
          <Text as="div" variant="hint">
            {e.client_nom}
          </Text>
        )}
      </div>
    ),
  },
  {
    id: 'lieu',
    header: 'Lieu',
    enableSorting: false,
    cell: ({ row: { original: e } }) => (
      <CelluleLieu nom={e.lieu_nom} adresse={e.lieu_adresse} />
    ),
  },
  ...(reglage.traiteur
    ? [
        {
          id: 'traiteur',
          header: 'Traiteur',
          enableSorting: false,
          cell: ({ row: { original: e } }) => e.traiteur_nom || <CelluleVide />,
        } satisfies ColumnDef<EvenementRow, unknown>,
      ]
    : []),
  {
    id: 'pax',
    header: 'Pax',
    enableSorting: false,
    meta: { className: 'text-right tabular-nums' },
    cell: ({ row: { original: e } }) =>
      e.pax != null ? fmtPax(e.pax) : <CelluleVide />,
  },
  {
    id: 'collectes',
    header: 'Collectes',
    enableSorting: false,
    cell: ({ row: { original: e } }) => {
      const libelle = libelleCollectes(e);
      return libelle ? (
        <span className="whitespace-nowrap">{libelle}</span>
      ) : (
        <CelluleVide />
      );
    },
  },
  {
    id: 'resultats',
    header: 'Résultats',
    enableSorting: false,
    cell: ({ row: { original: e } }) => <ResultatsEvenement e={e} />,
  },
  // Gestionnaire seul (§05 R_dechets_labo_estimes : coefficient du traiteur
  // confidentiel).
  ...(reglage.labo
    ? [
        {
          // Estimation amont (§05 R_dechets_labo_estimes) : « — » si l'événement n'a
          // aucune collecte ZD ou si le traiteur n'a pas communiqué de coefficient.
          id: 'dechets_labo',
          header: 'Déchets labo est.',
          enableSorting: false,
          meta: { className: 'text-right tabular-nums' },
          cell: ({ row: { original: e } }) =>
            e.dechets_labo_kg != null ? (
              <span className="whitespace-nowrap">
                {fmtKg(e.dechets_labo_kg)}
              </span>
            ) : (
              <CelluleVide />
            ),
        } satisfies ColumnDef<EvenementRow, unknown>,
      ]
    : []),
  {
    id: 'statut',
    header: 'Statut',
    enableSorting: false,
    cell: ({ row: { original: e } }) => (
      <Badge
        variant={variantStatutEvenement(e.statut_consolide)}
        dot={false}
        className="whitespace-nowrap"
      >
        {e.statut_consolide}
      </Badge>
    ),
  },
  // Chevron : la ligne ouvre la fiche (revue écran 2026-10-29), pour tous les
  // rôles (Val 2026-10-29).
  {
    id: 'ouvrir',
    header: () => <span className="sr-only">Ouvrir</span>,
    enableHiding: false,
    enableSorting: false,
    meta: { label: 'Ouvrir', hideOnMobile: true, className: 'w-[1%]' },
    cell: () => <ChevronLigne />,
  },
];

/**
 * Pose (ou retire, valeur `null`) des clés de l'adresse courante sans toucher
 * aux autres — les filtres, que `useFiltresUrl` tient de son côté. `null` comme
 * état : Next.js resynchronise alors `useSearchParams` (cf. useFiltresUrl).
 */
function majAdresse(patch: Record<string, string | null>) {
  const usp = new URLSearchParams(window.location.search);
  for (const [cle, valeur] of Object.entries(patch)) {
    if (valeur) usp.set(cle, valeur);
    else usp.delete(cle);
  }
  const qs = usp.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`,
  );
}

function ListeEvenementsContenu({ espace }: { espace: EspaceListeEvenements }) {
  const reglage = REGLAGES[espace];
  const params = useSearchParams();
  const { valeurs: f, set, reset, actif } = useFiltresUrl(FILTRES);
  // Fiche événement en pop-up (demande Val 2026-10-19, comme la fiche collecte
  // sur la liste Collectes). L'adresse porte la fiche ouverte (?evenement=<id>,
  // et ?collecte=<id> pour la fiche collecte ouverte par-dessus) : un lien
  // direct, un rechargement ou l'ancienne route /gestionnaire/evenements/<id>
  // (qui redirige ici) rouvrent les mêmes fiches.
  const [ouverte, setOuverte] = useState<{
    evenement: string;
    collecte: string | null;
  } | null>(() => {
    const evenement = params?.get('evenement');
    return evenement
      ? { evenement, collecte: params?.get('collecte') || null }
      : null;
  });
  const page = f.page;
  const allerPage = (p: number) => set({ page: p });
  const vue = lireVueCollectes(f.onglet) ?? 'a_venir';
  const ordre = f.ordre || (triDateDescendant(vue) ? 'desc' : 'asc');
  const sorting: SortingState = [{ id: 'date', desc: ordre === 'desc' }];
  // Jour lu à chaque rendu : une page restée ouverte passé minuit se recale
  // au premier geste.
  const aujourdhui = jourParis();
  const colonnes = useMemo(
    () => colonnesEvenements(aujourdhui, reglage),
    [aujourdhui, reglage],
  );

  const urlListe = useMemo(() => {
    const qs = new URLSearchParams();
    // Période de la barre, bornée à la vue (à venir : aujourd'hui et après).
    const periode = periodeDeLaVue(vue, { from: f.from, to: f.to }, aujourdhui);
    if (f.type) qs.set('type', f.type);
    if (periode.from) qs.set('from', periode.from);
    if (periode.to) qs.set('to', periode.to);
    if (f.lieu.length > 0) qs.set('lieu_ids', f.lieu.join(','));
    if (reglage.traiteur && f.traiteur.length > 0)
      qs.set('traiteur_ids', f.traiteur.join(','));
    if (reglage.client && f.client.length > 0)
      qs.set('client_ids', f.client.join(','));
    // La route lit Type et Taille d'événement en paramètre répété (`x[]`).
    f.type_evenement_ids.forEach((v) => qs.append('type_evenement_ids[]', v));
    f.taille_evenements.forEach((v) => qs.append('taille_evenements[]', v));
    qs.set('tri', 'date');
    qs.set('ordre', ordre === 'asc' ? 'asc' : 'desc');
    if (page > 1) qs.set('page', String(page));
    return `/api/v1/evenements?${qs}`;
  }, [
    vue,
    aujourdhui,
    f.type,
    f.from,
    f.to,
    f.lieu,
    f.traiteur,
    f.client,
    reglage,
    f.type_evenement_ids,
    f.taille_evenements,
    ordre,
    page,
  ]);

  // Export CSV (§12 §2) : la sélection de la liste affichée (ses filtres,
  // période bornée à la vue), sans tri ni page.
  function exporterCsv() {
    const qs = new URLSearchParams(urlListe.split('?')[1]);
    for (const cle of ['tri', 'ordre', 'page']) qs.delete(cle);
    window.open(`/api/v1/exports/evenements?${qs}`);
  }

  // Liste paginée serveur : garde anti-réponse périmée et état Error portés par
  // `useListePaginee` — une panne ne se lit jamais comme un parc vide (§10 §7).
  const {
    data: rows,
    total,
    loading: chargement,
    erreur,
    recharger,
  } = useListePaginee<EvenementRow>(urlListe, {
    extraire: (j) => {
      const r = j as { data?: EvenementRow[]; total?: number };
      const data = r.data ?? [];
      return {
        data,
        total: typeof r.total === 'number' ? r.total : data.length,
      };
    },
    messageErreur: 'Le chargement des événements a échoué.',
  });

  const [options, setOptions] =
    useState<OptionsFiltresEvenements>(OPTIONS_VIDES);
  useEffect(() => {
    fetch('/api/v1/evenements/filtres')
      .then((r) => {
        // Une réponse en erreur ne se lit pas comme des listes vides.
        if (!r.ok) throw new Error(`filtres ${r.status}`);
        return r.json();
      })
      .then((j: { data?: Partial<OptionsFiltresEvenements> }) => {
        if (j?.data)
          setOptions({
            lieux: j.data.lieux ?? [],
            traiteurs: j.data.traiteurs ?? [],
            clients: j.data.clients ?? [],
            types: j.data.types ?? [],
          });
      })
      .catch(() => {
        /* options indisponibles : la barre reste utilisable (listes vides). */
      });
  }, []);

  // Page devenue hors bornes (liste rétrécie, lien partagé) : le serveur rend
  // une page vide AVEC le vrai total ; l'écran redescend sur la dernière page
  // valide plutôt que d'afficher l'état vide d'un parc sans événement.
  const dernierePage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const redirige =
    !chargement &&
    !erreur &&
    rows.length === 0 &&
    total > 0 &&
    page > dernierePage;
  // `enRedirection` couvre le rendu intermédiaire (page corrigée, réponse pas
  // encore reçue) : sans lui, l'état vide passe un instant à l'écran. Il tombe
  // à l'arrivée des lignes suivantes (nouveau tableau `rows`), pas au passage de
  // `chargement` : une réponse immédiate peut ne jamais laisser voir
  // `chargement` à vrai, et l'écran resterait en squelette. Déclaré AVANT
  // l'effet de redirection : sur la réponse hors bornes, il passe le premier,
  // puis la redirection le relève.
  const [enRedirection, setEnRedirection] = useState(false);
  useEffect(() => {
    setEnRedirection(false);
  }, [rows]);
  useEffect(() => {
    if (redirige) {
      setEnRedirection(true);
      allerPage(dernierePage);
    }
    // allerPage dépend de `set` (stable) : la condition seule compte.
  }, [redirige, dernierePage]);
  const loading = chargement || redirige || enRedirection;

  function ouvrirFiche(evenement: string) {
    setOuverte({ evenement, collecte: null });
    majAdresse({ evenement, collecte: null });
  }
  // Une modification faite depuis la fiche (fiche collecte) peut changer les
  // résultats de la ligne : la liste est rechargée à la fermeture.
  function fermerFiche() {
    setOuverte(null);
    majAdresse({ evenement: null, collecte: null });
    recharger();
  }

  const contenu = erreur ? (
    <ErrorState
      data-testid="evenements-erreur"
      message={erreur}
      onRetry={recharger}
    />
  ) : loading ? (
    <SqueletteListe />
  ) : rows.length === 0 ? (
    <EmptyState
      icon={<CalendarDotsIcon />}
      title="Aucun événement"
      description={reglage.vide}
    />
  ) : (
    <>
      <DataGrid
        data-testid="evenements-table"
        toolbarActions={<BoutonExportCsv onClick={exporterCsv} />}
        columns={colonnes}
        data={rows}
        getRowId={(e) => e.id}
        manualSorting
        sorting={sorting}
        onSortingChange={(u) => {
          const suivant = typeof u === 'function' ? u(sorting) : u;
          const t = suivant[0];
          // Tri retiré (cycle TanStack) = tri par défaut de la vue.
          set({ ordre: t ? (t.desc ? 'desc' : 'asc') : '' });
        }}
        onRowClick={(e) => ouvrirFiche(e.id)}
        rowLabel={(e) =>
          `Ouvrir l'événement${e.nom_evenement ? ` ${e.nom_evenement}` : ''}`
        }
      />
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
        icon={<CalendarDotsIcon className="h-6 w-6 text-savr-primary-200" />}
        title="Événements"
        subtitle={reglage.sousTitre}
      />

      <FilterBar
        data-testid="evenements-filtres-bar"
        tabs={
          <OngletsVueCollectes
            value={vue}
            // Changer de vue reprend son tri par défaut (et la page 1).
            onChange={(v) => set({ onglet: v, ordre: '' })}
            libelles={LIBELLES_EVENEMENTS}
          />
        }
        toggle={
          <ToggleTypeCollecte
            avecTous
            value={
              f.type === 'zero_dechet' || f.type === 'anti_gaspi'
                ? f.type
                : 'tous'
            }
            onChange={(t) => set({ type: t === 'tous' ? '' : t })}
          />
        }
        actif={actif}
        onReset={reset}
        count={
          <span data-testid="evenements-resultats-count">
            {total} événement{total > 1 ? 's' : ''} correspond
            {total > 1 ? 'ent' : ''} à votre sélection
          </span>
        }
      >
        <DateRangePicker
          titre="Période"
          id="filtre-periode"
          data-testid="filtre-periode"
          value={{ from: f.from, to: f.to }}
          onChange={(p) => set({ from: p.from, to: p.to })}
        />
        <FiltreCoches
          label="Lieu"
          testid="filtre-lieu"
          options={options.lieux}
          selected={f.lieu}
          onChange={(ids) => set({ lieu: ids })}
        />
        {reglage.traiteur && (
          <FiltreCoches
            label="Traiteur"
            testid="filtre-traiteur"
            options={options.traiteurs}
            selected={f.traiteur}
            onChange={(ids) => set({ traiteur: ids })}
          />
        )}
        {reglage.client && (
          <FiltreCoches
            label="Client"
            testid="filtre-client"
            options={options.clients}
            selected={f.client}
            onChange={(ids) => set({ client: ids })}
          />
        )}
        <FiltreCoches
          label="Type d'événement"
          testid="filtre-type-evenement"
          options={options.types.map((t) => ({ id: t.id, nom: t.libelle }))}
          selected={f.type_evenement_ids}
          onChange={(ids) => set({ type_evenement_ids: ids })}
        />
        <FiltreCoches
          label="Taille d'événement"
          testid="filtre-taille-evenement"
          options={TAILLE_OPTIONS}
          selected={f.taille_evenements}
          onChange={(ids) => set({ taille_evenements: ids })}
        />
      </FilterBar>

      {contenu}

      {ouverte && (
        <FicheEvenementModal
          espace={espace}
          // Une fiche par événement : changer d'événement repart de zéro.
          key={ouverte.evenement}
          evenementId={ouverte.evenement}
          collecteInitiale={ouverte.collecte}
          onCollecteChange={(collecte) => majAdresse({ collecte })}
          onClose={fermerFiche}
        />
      )}
    </div>
  );
}

/**
 * Liste Événements, commune à tous les rôles (décision Val 2026-10-29) : une
 * seule implémentation, montée par la page Événements de chaque espace.
 */
export function ListeEvenements({ espace }: { espace: EspaceListeEvenements }) {
  return (
    <Suspense fallback={<SqueletteListe />}>
      <ListeEvenementsContenu espace={espace} />
    </Suspense>
  );
}
