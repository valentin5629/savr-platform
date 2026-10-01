'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
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
const PAGE_SIZES = [25, 50, 100];

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
  return `${kg.toFixed(2).replace('.', ',')} kg`;
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
  const [rows, setRows] = useState<RegistreRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  // Chaque appel prend un numéro ; seule la réponse du dernier appel a le droit
  // d'écrire dans l'état. Filtres, tri et pagination relancent un chargement :
  // sans cette garde, la réponse PÉRIMÉE (ou son échec) d'un appel encore en vol
  // écraserait celle des critères courants.
  const generation = useRef(0);

  // Filtres
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flux, setFlux] = useState<string[]>([]);
  // Lieu / Traiteur / Bordereau à choix multiple, case « Tous » = sélection
  // vide (§06.03 « multi-select » ; décision Val 2026-09-30).
  const [lieux, setLieux] = useState<string[]>([]);
  const [traiteurs, setTraiteurs] = useState<string[]>([]);
  const [bordereaux, setBordereaux] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('date_evenement');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const queryString = useCallback(
    (forExport: boolean): string => {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (flux.length) qs.set('flux', flux.join(','));
      if (lieux.length) qs.set('lieu', lieux.join(','));
      if (traiteurs.length) qs.set('traiteur', traiteurs.join(','));
      const bordereau = valeurUnique(bordereaux);
      if (bordereau) qs.set('bordereau', bordereau);
      if (!forExport) {
        qs.set('sortBy', sortBy);
        qs.set('sortDir', sortDir);
        qs.set('page', String(page));
        qs.set('pageSize', String(pageSize));
      }
      return qs.toString();
    },
    [
      from,
      to,
      flux,
      lieux,
      traiteurs,
      bordereaux,
      sortBy,
      sortDir,
      page,
      pageSize,
    ],
  );

  const charger = useCallback(() => {
    const gen = ++generation.current;
    const perime = () => generation.current !== gen;
    setLoading(true);
    setErreur(null);
    fetch(`/api/v1/registre?${queryString(false)}`)
      .then((r) => {
        // Sans cette garde, un 500 rendait `rows` absent → liste vide → l'écran
        // affichait « Aucune collecte au registre pour ces critères. » : une
        // panne serveur se lisait comme un registre vide (§10 §7, état Error
        // distinct de l'état Empty).
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j: { rows?: RegistreRow[]; total?: number }) => {
        if (perime()) return;
        setRows(j.rows ?? []);
        setTotal(j.total ?? 0);
      })
      .catch(() => {
        if (!perime()) setErreur('Le chargement du registre a échoué.');
      })
      .finally(() => {
        if (!perime()) setLoading(false);
      });
  }, [queryString]);

  useEffect(() => {
    charger();
  }, [charger]);

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
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(key);
      setSortDir('asc');
    }
    setPage(1);
  }
  async function downloadBordereau(id: string) {
    const res = await fetch(
      `/api/v1/registre/bordereaux/${encodeURIComponent(id)}/download`,
    );
    if (!res.ok) return;
    const j = (await res.json()) as { url?: string };
    if (j.url) window.open(j.url, '_blank');
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Liste PAGINÉE côté serveur (`fetchRegistre` : `.range()` + `.order(sortBy)`).
  // Le tri n'est donc jamais fait sur la seule page affichée : `manualSorting`,
  // chaque clic d'en-tête passe par `sort()` qui renvoie `sortBy`/`sortDir` à
  // l'API (comportement inchangé : même colonne = inverse le sens, autre
  // colonne = ascendant, retour en page 1). L'`id` des colonnes triables = la
  // valeur de `sortBy` ; l'`accessorFn` n'est là que pour rendre l'en-tête
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
          <button
            type="button"
            className="text-savr-primary-700 underline"
            onClick={() => downloadBordereau(r.bordereau_id!)}
          >
            {r.bordereau_numero ?? 'PDF'} ⬇
          </button>
        ) : (
          <span className="text-savr-neutral-400">Manquant</span>
        ),
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-savr-primary-800">
          Registre réglementaire
        </h1>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Barre de filtres — pattern DS `FilterBar` : filtres en ligne
          « Titre  valeur ▾ » (décision Val 2026-09-30). */}
      <FilterBar
        data-testid="registre-filtres"
        actif={
          from !== '' ||
          to !== '' ||
          flux.length > 0 ||
          lieux.length > 0 ||
          traiteurs.length > 0 ||
          bordereaux.length > 0
        }
        onReset={() => {
          setPage(1);
          setFrom('');
          setTo('');
          setFlux([]);
          setLieux([]);
          setTraiteurs([]);
          setBordereaux([]);
        }}
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
          value={{ from, to }}
          onChange={(p) => {
            setPage(1);
            setFrom(p.from);
            setTo(p.to);
          }}
        />
        <FiltreCoches
          label="Lieu"
          testid="registre-lieu"
          options={optionsAffichees.lieux}
          selected={lieux}
          onChange={(ids) => {
            setPage(1);
            setLieux(ids);
          }}
        />
        <FiltreCoches
          label="Traiteur"
          testid="registre-traiteur"
          options={optionsAffichees.traiteurs}
          selected={traiteurs}
          onChange={(ids) => {
            setPage(1);
            setTraiteurs(ids);
          }}
        />
        <FiltreCoches
          label="Bordereau"
          testid="registre-bordereau"
          options={[
            { id: 'dispo', nom: 'Disponible' },
            { id: 'manquant', nom: 'Manquant' },
          ]}
          selected={bordereaux}
          onChange={(ids) => {
            setPage(1);
            setBordereaux(ids);
          }}
        />
        <FiltreCoches
          label="Flux"
          testid="registre-flux"
          options={FLUX_ORDER.map((code) => ({
            id: code,
            nom: FLUX_LABELS[code] ?? code,
          }))}
          selected={flux}
          onChange={(codes) => {
            setPage(1);
            setFlux(codes);
          }}
        />
      </FilterBar>

      {/* États système §10 §7 — Error = message + « Réessayer », distinct de
          l'état Empty : une panne ne doit jamais se lire comme un registre vide. */}
      {erreur ? (
        <div className="space-y-4" data-testid="registre-erreur">
          <AlertBar variant="err">{erreur}</AlertBar>
          <Button variant="secondary" onClick={charger}>
            Réessayer
          </Button>
        </div>
      ) : (
        <DataGrid
          data-testid="registre-table"
          columns={colonnes}
          data={rows}
          getRowId={(r) => r.collecte_id}
          loading={loading}
          empty={
            <p className="text-sm text-savr-neutral-500">
              Aucune collecte au registre pour ces critères.
            </p>
          }
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
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-savr-neutral-500">
        <span>{total} ligne(s)</span>
        <div className="flex items-center gap-2">
          <Combobox
            aria-label="Lignes par page"
            data-testid="registre-page-size"
            icon={null}
            className="w-32"
            options={PAGE_SIZES.map((s) => ({
              value: String(s),
              label: `${s} / page`,
            }))}
            value={String(pageSize)}
            onChange={(v) => {
              setPage(1);
              setPageSize(Number(v));
            }}
          />
          <Button
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Précédent
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Suivant
          </Button>
        </div>
      </div>
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
