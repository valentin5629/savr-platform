'use client';

import { fmtKg } from '@/lib/format';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DataGrid,
  type ColumnDef,
  type SortingState,
} from '@/components/ui/data-grid';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import {
  FiltreCoches,
  type OptionFiltre,
} from '@/components/ui/filtre-en-ligne';
import { valeurUnique } from '@/lib/filtre-csv';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { ListFooter } from '@/components/ui/list-footer';
import {
  useFiltresUrl,
  texte,
  liste,
  entier,
  navigation,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';

// ---------------------------------------------------------------------------
// Registre réglementaire ZD (§06.03) — vue liste : tableau chronologique des
// collectes cloturee ZD du périmètre, filtres, tri mono-colonne, pagination,
// exports CSV / ZIP, notice méthodologique. Cloisonnement porté par l'API/vue.
// ---------------------------------------------------------------------------

const FLUX_LABELS: Record<string, string> = {
  biodechet: 'Biodéchets',
  emballage: 'Emballages',
  carton: 'Cartons',
  verre: 'Verre',
  dechet_residuel: 'Déchet résiduel',
};
const FLUX_ORDER = [
  'biodechet',
  'emballage',
  'carton',
  'verre',
  'dechet_residuel',
];
const PAGE_SIZES = [25, 50, 100] as const;

// Filtres du registre, miroir dans l'URL (R-UI-4a) : Lieu / Traiteur /
// Bordereau à choix multiple, case « Tous » = sélection vide (§06.03
// « multi-select » ; décision Val 2026-09-30). Tri serveur `tri`/`ordre`
// (convention unique), `limit` = lignes par page.
const FILTRES = {
  from: texte(''),
  to: texte(''),
  flux: liste(),
  lieu: liste(),
  traiteur: liste(),
  bordereau: liste(),
  page: navigation(entier(1)),
  limit: navigation(entier(25)),
  tri: navigation(texte('date_evenement')),
  ordre: navigation(texte('desc')),
};

interface RegistreRow {
  collecte_id: string;
  date_evenement: string | null;
  lieu_id: string | null;
  lieu_nom: string | null;
  traiteur_operationnel_organisation_id: string | null;
  traiteur_raison_sociale: string | null;
  exutoire_nom: string | null;
  poids_total_kg: number | null;
  flux_codes: string[] | null;
  bordereau_id: string | null;
  bordereau_numero: string | null;
  bordereau_statut: string | null;
  historique_partiel: boolean | null;
}

type SortKey =
  | 'date_evenement'
  | 'lieu_nom'
  | 'traiteur_raison_sociale'
  | 'poids_total_kg'
  | 'exutoire_nom';

function poidsFr(kg: number | null): string {
  if (kg == null) return '—';
  return fmtKg(kg, 2);
}
function dateFr(d: string | null): string {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}
function bordereauDispo(statut: string | null): boolean {
  return statut === 'emis' || statut === 'corrige';
}
/** Options distinctes tirées des lignes affichées (repli des filtres). */
function optionsDesLignes(
  rows: RegistreRow[],
  cle: (r: RegistreRow) => [string | null, string | null],
): OptionFiltre[] {
  const m = new Map<string, string>();
  for (const r of rows) {
    const [id, nom] = cle(r);
    if (id && nom) m.set(id, nom);
  }
  return [...m].map(([id, nom]) => ({ id, nom }));
}

function RegistreContent() {
  const router = useRouter();
  const {
    valeurs: f,
    set,
    reset,
    actif: filtresActifs,
  } = useFiltresUrl(FILTRES);
  const sortBy = f.tri as SortKey;
  const sortDir: 'asc' | 'desc' = f.ordre === 'asc' ? 'asc' : 'desc';
  const pageSize = (PAGE_SIZES as readonly number[]).includes(f.limit)
    ? f.limit
    : 25;

  // Paramètres de filtre (partagés avec les exports) ; `forExport` = sans tri
  // ni pagination.
  const queryString = (forExport: boolean): string => {
    const qs = new URLSearchParams();
    if (f.from) qs.set('from', f.from);
    if (f.to) qs.set('to', f.to);
    if (f.flux.length) qs.set('flux', f.flux.join(','));
    if (f.lieu.length) qs.set('lieu', f.lieu.join(','));
    if (f.traiteur.length) qs.set('traiteur', f.traiteur.join(','));
    const bordereau = valeurUnique(f.bordereau);
    if (bordereau) qs.set('bordereau', bordereau);
    if (!forExport) {
      qs.set('tri', sortBy);
      qs.set('ordre', sortDir);
      qs.set('page', String(f.page));
      qs.set('limit', String(pageSize));
    }
    return qs.toString();
  };
  const urlListe = useMemo(
    () => `/api/v1/registre?${queryString(false)}`,
    // queryString ne dépend que de `f`.
    [f],
  );
  // L'API répond `{ rows, total }` ; une panne (`!ok`) donne l'état Error
  // (§10 §7), jamais un registre vide.
  const {
    data: rows,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<RegistreRow>(urlListe, {
    extraire: (j) => {
      const r = j as { rows?: RegistreRow[]; total?: number };
      return { data: r.rows ?? [], total: r.total ?? 0 };
    },
    messageErreur: 'Le chargement du registre a échoué.',
  });

  // Options Lieu / Traiteur = tout le registre du périmètre (arbitrage Val F2
  // 2026-10-01), chargées une fois : dérivées de la page affichée, cocher un
  // lieu faisait disparaître les autres de la liste. Tant qu'elles manquent
  // (chargement, ou route en échec), repli sur les lignes affichées plutôt
  // qu'une liste vide sans explication.
  const [options, setOptions] = useState<{
    lieux: OptionFiltre[];
    traiteurs: OptionFiltre[];
  } | null>(null);
  useEffect(() => {
    let annule = false;
    fetch('/api/v1/registre/options')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (j: { lieux?: OptionFiltre[]; traiteurs?: OptionFiltre[] } | null) => {
          if (!annule && j)
            setOptions({ lieux: j.lieux ?? [], traiteurs: j.traiteurs ?? [] });
        },
      )
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, []);
  const optionsAffichees = options ?? {
    lieux: optionsDesLignes(rows, (r) => [r.lieu_id, r.lieu_nom]),
    traiteurs: optionsDesLignes(rows, (r) => [
      r.traiteur_operationnel_organisation_id,
      r.traiteur_raison_sociale,
    ]),
  };

  function sort(key: SortKey) {
    if (sortBy === key) set({ ordre: sortDir === 'asc' ? 'desc' : 'asc' });
    else set({ tri: key, ordre: 'asc' });
  }
  async function downloadBordereau(id: string) {
    const res = await fetch(
      `/api/v1/registre/bordereaux/${encodeURIComponent(id)}/download`,
    );
    if (!res.ok) return;
    const j = (await res.json()) as { url?: string };
    if (j.url) window.open(j.url, '_blank');
  }

  // Liste PAGINÉE côté serveur (`fetchRegistre` : `.range()` + `.order(sortBy)`).
  // Le tri n'est donc jamais fait sur la seule page affichée : `manualSorting`,
  // chaque clic d'en-tête passe par `sort()` qui renvoie `tri`/`ordre` à
  // l'API (comportement inchangé : même colonne = inverse le sens, autre
  // colonne = ascendant, retour en page 1). L'`id` des colonnes triables = la
  // valeur de `tri` ; l'`accessorFn` n'est là que pour rendre l'en-tête
  // cliquable (règle TanStack), il ne trie rien côté navigateur.
  const sorting: SortingState = [{ id: sortBy, desc: sortDir === 'desc' }];
  const colonnes: ColumnDef<RegistreRow, unknown>[] = [
    {
      id: 'date_evenement',
      header: 'Date événement',
      enableHiding: false,
      accessorFn: (r) => r.date_evenement ?? '',
      cell: ({ row: { original: r } }) => (
        <span className="whitespace-nowrap">
          {dateFr(r.date_evenement)}
          {r.historique_partiel && (
            <span
              className="ml-1"
              title="Historique partiel (migration incomplète)"
            >
              ⚠
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'lieu_nom',
      header: 'Lieu',
      accessorFn: (r) => r.lieu_nom ?? '',
      cell: ({ row: { original: r } }) => r.lieu_nom ?? '—',
    },
    {
      id: 'traiteur_raison_sociale',
      header: 'Traiteur',
      accessorFn: (r) => r.traiteur_raison_sociale ?? '',
      cell: ({ row: { original: r } }) => r.traiteur_raison_sociale ?? '—',
    },
    {
      id: 'flux',
      header: 'Flux',
      cell: ({ row: { original: r } }) => (
        <div className="flex flex-wrap gap-1">
          {(r.flux_codes ?? []).map((c) => (
            <Badge key={c} variant="neutral">
              {FLUX_LABELS[c] ?? c}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'poids_total_kg',
      header: 'Poids total',
      accessorFn: (r) => r.poids_total_kg ?? -1,
      cell: ({ row: { original: r } }) => (
        <span className="whitespace-nowrap">{poidsFr(r.poids_total_kg)}</span>
      ),
    },
    {
      id: 'exutoire_nom',
      header: 'Exutoire',
      accessorFn: (r) => r.exutoire_nom ?? '',
      cell: ({ row: { original: r } }) => r.exutoire_nom ?? '—',
    },
    {
      id: 'bordereau',
      header: 'Bordereau',
      meta: { interactive: true },
      cell: ({ row: { original: r } }) =>
        r.bordereau_id && bordereauDispo(r.bordereau_statut) ? (
          <TextLink onClick={() => downloadBordereau(r.bordereau_id!)}>
            {r.bordereau_numero ?? 'PDF'} ⬇
          </TextLink>
        ) : (
          <span className="text-savr-neutral-400">Manquant</span>
        ),
    },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Registre réglementaire"
        actions={
          <>
            <Button variant="ghost" asChild>
              <a href="/registre/methodologie">Méthodologie</a>
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                window.open(`/api/v1/registre/export-csv?${queryString(true)}`)
              }
            >
              Exporter CSV
            </Button>
            <Button
              onClick={() =>
                window.open(`/api/v1/registre/export-zip?${queryString(true)}`)
              }
            >
              Télécharger tous les bordereaux
            </Button>
          </>
        }
      />

      {/* Barre de filtres — pattern DS `FilterBar` : filtres en ligne
          « Titre  valeur ▾ » (décision Val 2026-09-30). */}
      <FilterBar
        data-testid="registre-filtres"
        count={`${total} ligne${total > 1 ? 's' : ''}`}
        actif={filtresActifs}
        onReset={reset}
      >
        {/* BL-P3-10 — Preset « 30 derniers jours » (CDC §06.03) : raccourci de
            la liste standard du panneau Période. Le défaut au chargement reste
            vide (historique complet), arbitrage Val R23c. */}
        <DateRangePicker
          titre="Période"
          id="registre-periode"
          data-testid="registre-periode"
          placeholder="Tout l'historique"
          raccourcisTestIdPrefixe="registre-preset"
          value={{ from: f.from, to: f.to }}
          onChange={(p) => set({ from: p.from, to: p.to })}
        />
        <FiltreCoches
          label="Lieu"
          testid="registre-lieu"
          options={optionsAffichees.lieux}
          selected={f.lieu}
          onChange={(ids) => set({ lieu: ids })}
        />
        <FiltreCoches
          label="Traiteur"
          testid="registre-traiteur"
          options={optionsAffichees.traiteurs}
          selected={f.traiteur}
          onChange={(ids) => set({ traiteur: ids })}
        />
        <FiltreCoches
          label="Bordereau"
          testid="registre-bordereau"
          options={[
            { id: 'dispo', nom: 'Disponible' },
            { id: 'manquant', nom: 'Manquant' },
          ]}
          selected={f.bordereau}
          onChange={(ids) => set({ bordereau: ids })}
        />
        <FiltreCoches
          label="Flux"
          testid="registre-flux"
          options={FLUX_ORDER.map((code) => ({
            id: code,
            nom: FLUX_LABELS[code] ?? code,
          }))}
          selected={f.flux}
          onChange={(codes) => set({ flux: codes })}
        />
      </FilterBar>

      {/* États système §10 §7 — Error = message + « Réessayer » (DataGrid
          `erreur`), distinct de l'état Empty : une panne ne doit jamais se lire
          comme un registre vide. */}
      <DataGrid
        data-testid="registre-table"
        columns={colonnes}
        data={rows}
        getRowId={(r) => r.collecte_id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={<Text>Aucune collecte au registre pour ces critères.</Text>}
        manualSorting
        sorting={sorting}
        onSortingChange={(updater) => {
          const next =
            typeof updater === 'function' ? updater(sorting) : updater;
          const cle = next[0]?.id as SortKey | undefined;
          if (cle) sort(cle);
        }}
        onRowClick={(r) => router.push(`/registre/${r.collecte_id}`)}
        rowLabel={(r) =>
          `Ouvrir la collecte du ${dateFr(r.date_evenement)}${r.lieu_nom ? ` — ${r.lieu_nom}` : ''}`
        }
      />

      {/* Pagination + lignes par page (R-UI-4a : ListFooter commun) */}
      <ListFooter
        data-testid="registre-pagination"
        total={total}
        page={f.page}
        onPageChange={(page) => set({ page })}
        taillePage={pageSize}
        taillesPage={PAGE_SIZES}
        onTaillePageChange={(limit) => set({ limit })}
      />
    </div>
  );
}

export default function RegistrePage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <RegistreContent />
    </Suspense>
  );
}
