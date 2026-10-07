'use client';

import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { fmtKg } from '@/lib/format';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { CalendarDays, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import {
  EvenementsFilterBar,
  defaultEvenementsFilters,
  type EvenementsListFilters,
} from '@/components/dashboards/index.js';
import { lireTypesCollecte } from '@/lib/evenements-type-collecte';
import { variantStatutEvenement } from '@/lib/libelles/evenement';
import { PageHero } from '@/components/ui/page-hero';
import { Text } from '@/components/ui/text';
import { ROUTES } from '@/lib/routes';

interface EvenementRow {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  taille_bracket: string;
  lieu_nom: string | null;
  lieu_ville: string | null;
  traiteur_nom: string | null;
  statut_consolide: string;
  nb_collectes_zd: number;
  nb_collectes_ag: number;
  tonnage_zd_kg: number;
  dechets_labo_kg: number | null;
  repas_donnes: number;
  programmee_par_moi: boolean;
}

// Colonnes de la liste. Tri côté navigateur : la route renvoie la liste
// COMPLÈTE du périmètre filtré (aucun `.range()`, `total = rows.length`), trier
// ici porte donc bien sur tout l'ensemble. Ordre initial = celui de la route
// (date décroissante). Valeurs absentes triées comme -1 / chaîne vide.
const COLONNES: ColumnDef<EvenementRow, unknown>[] = [
  {
    id: 'date',
    header: 'Date',
    accessorFn: (e) => e.date_evenement ?? '',
    cell: ({ row: { original: e } }) => (
      <span className="whitespace-nowrap">{e.date_evenement ?? '—'}</span>
    ),
  },
  {
    id: 'evenement',
    header: 'Événement',
    accessorFn: (e) => e.nom_evenement ?? '',
    cell: ({ row: { original: e } }) => (
      <>
        <div className="font-medium">
          {e.nom_evenement ?? '—'}
          {e.programmee_par_moi && (
            <Badge variant="info" className="ml-1">
              Moi
            </Badge>
          )}
        </div>
        <Text as="div" variant="hint">
          {e.taille_bracket}
        </Text>
      </>
    ),
  },
  {
    id: 'lieu',
    header: 'Lieu',
    accessorFn: (e) => e.lieu_nom ?? '',
    cell: ({ row: { original: e } }) => (
      <>
        <div>{e.lieu_nom ?? '—'}</div>
        <Text as="div" variant="hint">
          {e.lieu_ville ?? ''}
        </Text>
      </>
    ),
  },
  {
    id: 'traiteur',
    header: 'Traiteur',
    accessorFn: (e) => e.traiteur_nom ?? '',
    cell: ({ row: { original: e } }) => e.traiteur_nom ?? '—',
  },
  {
    id: 'pax',
    header: 'Pax',
    accessorFn: (e) => e.pax ?? -1,
    cell: ({ row: { original: e } }) => e.pax ?? '—',
  },
  {
    id: 'collectes',
    header: 'Collectes',
    accessorFn: (e) => e.nb_collectes_zd + e.nb_collectes_ag,
    cell: ({ row: { original: e } }) => (
      <span className="text-xs">
        {e.nb_collectes_zd > 0 && (
          <span className="mr-1">{e.nb_collectes_zd} ZD</span>
        )}
        {e.nb_collectes_ag > 0 && <span>{e.nb_collectes_ag} AG</span>}
        {e.nb_collectes_zd === 0 && e.nb_collectes_ag === 0 && '—'}
      </span>
    ),
  },
  {
    id: 'tonnage',
    header: 'Tonnage total',
    accessorFn: (e) => e.tonnage_zd_kg,
    cell: ({ row: { original: e } }) => (
      <span className="whitespace-nowrap">
        {e.tonnage_zd_kg > 0 ? fmtKg(e.tonnage_zd_kg) : '—'}
      </span>
    ),
  },
  // §06.05 §2 l.309 : « — si coefficient non communiqué ». « — » aussi pour
  // un événement qui n'a que des collectes anti-gaspi : la route ne rend
  // d'estimation que s'il a au moins une collecte ZD (arbitrage Val 2026-10-07).
  // Atteignable depuis 20260921190000 — f_dechets_labo_estimes
  // remonte NULL au lieu de 0 quand le traiteur n'a pas
  // communiqué de coefficient (et sur événement hors
  // périmètre). Un « 0 kg » affiché correspond donc à un
  // coefficient DÉCLARÉ à zéro — à une exception près, tracée
  // et hors lot : `pax = 0` rend aussi 0 alors que §05 veut
  // NULL (_Divergences/M3.2_20260921_dechets-labo-pax-zero.md).
  {
    id: 'dechets_labo',
    header: 'Déchets labo est.',
    accessorFn: (e) => e.dechets_labo_kg ?? -1,
    cell: ({ row: { original: e } }) => (
      <span className="whitespace-nowrap">
        {e.dechets_labo_kg != null ? fmtKg(e.dechets_labo_kg) : '—'}
      </span>
    ),
  },
  {
    id: 'repas',
    header: 'Repas donnés',
    accessorFn: (e) => e.repas_donnes,
    cell: ({ row: { original: e } }) =>
      e.repas_donnes > 0 ? e.repas_donnes : '—',
  },
  {
    id: 'statut',
    header: 'Statut',
    accessorFn: (e) => e.statut_consolide,
    cell: ({ row: { original: e } }) => (
      <Badge variant={variantStatutEvenement(e.statut_consolide)}>
        {e.statut_consolide}
      </Badge>
    ),
  },
];

// Query string (deep-linkable §06.05 l.99) → filtres. Utilisé à l'init + par les
// cartes KPI du dashboard qui transmettent les filtres globaux.
function filtersFromParams(params: URLSearchParams): EvenementsListFilters {
  const base = defaultEvenementsFilters();
  return {
    from: params.get('from') ?? base.from,
    to: params.get('to') ?? base.to,
    lieu_ids: params.getAll('lieu_ids[]'),
    traiteur_ids: params.getAll('traiteur_ids[]'),
    type_evenement_ids: params.getAll('type_evenement_ids[]'),
    taille_evenement_codes: params.getAll('taille_evenements[]'),
    // `types_collecte[]`, ou l'ancien `type_collecte` d'un lien existant
    // (même lecture que la route).
    types_collecte: lireTypesCollecte(params),
    statut_consolide: params.getAll('statut_consolide[]'),
  };
}

function toQueryString(f: EvenementsListFilters): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  f.lieu_ids.forEach((id) => qs.append('lieu_ids[]', id));
  f.traiteur_ids.forEach((id) => qs.append('traiteur_ids[]', id));
  f.type_evenement_ids.forEach((id) => qs.append('type_evenement_ids[]', id));
  f.taille_evenement_codes.forEach((c) => qs.append('taille_evenements[]', c));
  f.types_collecte.forEach((t) => qs.append('types_collecte[]', t));
  f.statut_consolide.forEach((s) => qs.append('statut_consolide[]', s));
  return qs;
}

function EvenementsContent() {
  const router = useRouter();
  const params = useSearchParams();
  // État = source unique, initialisé une fois depuis la query string (deep-link,
  // §06.05 l.99). Lecture initiale unique → deps [] volontaire (params capturé au
  // premier rendu ; les changements ultérieurs viennent de l'état, pas de l'URL).
  const initial = useMemo(
    () => filtersFromParams(new URLSearchParams(params.toString())),
    [],
  );
  const [filters, setFilters] = useState<EvenementsListFilters>(initial);
  const [rows, setRows] = useState<EvenementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  // Chaque appel prend un numéro ; seule la réponse du dernier appel a le droit
  // d'écrire dans l'état. Sans cette garde, un filtre changé pendant qu'une
  // requête est en vol laisse la réponse PÉRIMÉE (ou son échec) écraser celle
  // des filtres courants.
  const generation = useRef(0);

  const charger = useCallback(() => {
    const gen = ++generation.current;
    const perime = () => generation.current !== gen;
    setLoading(true);
    setErreur(null);
    const qs = toQueryString(filters);
    fetch(`/api/v1/gestionnaire/evenements?${qs}`)
      .then((r) => {
        // Sans cette garde, un 500 rendait `data` absent → liste vide → l'écran
        // affichait « Aucun événement. » : une panne serveur se lisait comme un
        // parc sans événement (§10 §7, état Error distinct de l'état Empty).
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (!perime()) setRows((j.data ?? []) as EvenementRow[]);
      })
      .catch(() => {
        if (!perime()) setErreur('Le chargement des événements a échoué.');
      })
      .finally(() => {
        if (!perime()) setLoading(false);
      });
  }, [filters]);

  useEffect(() => {
    // Reflète les filtres dans l'URL (deep-linkable §06.05 l.99), sans rechargement.
    router.replace(
      `${ROUTES.gestionnaire.evenements}?${toQueryString(filters)}`,
      {
        scroll: false,
      },
    );
    charger();
    // router hors deps (référence stable Next) : refetch au changement de filtres
    // (`charger` est recréé à chaque changement de `filters`).
  }, [charger]);

  function exportCsv() {
    const qs = toQueryString(filters);
    window.open(`/api/v1/gestionnaire/evenements/export-csv?${qs}`);
  }

  return (
    <div className="space-y-4">
      <PageHero
        icon={<CalendarDays className="h-6 w-6 text-savr-primary-200" />}
        title="Événements"
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download />
            Exporter CSV
          </Button>
        }
      />

      <EvenementsFilterBar
        value={filters}
        onChange={setFilters}
        resultCount={loading || erreur ? undefined : rows.length}
      />

      {/* États système §10 §7 — Error = message + « Réessayer », distinct de
          l'état Empty : une panne ne doit jamais se lire comme une liste vide. */}
      {erreur ? (
        <ErrorState
          data-testid="evenements-erreur"
          message={erreur}
          onRetry={charger}
        />
      ) : (
        <DataGrid
          data-testid="evenements-table"
          columns={COLONNES}
          data={rows}
          getRowId={(e) => e.id}
          loading={loading}
          empty={<EmptyState size="inline" title="Aucun événement." />}
          onRowClick={(e) => router.push(ROUTES.gestionnaire.evenement(e.id))}
          rowLabel={(e) =>
            `Ouvrir l'événement${e.nom_evenement ? ` ${e.nom_evenement}` : ''}`
          }
        />
      )}
    </div>
  );
}

export default function GestionnaireEvenementsPage() {
  return (
    <Suspense fallback={<LoadingState className="p-4" />}>
      <EvenementsContent />
    </Suspense>
  );
}
