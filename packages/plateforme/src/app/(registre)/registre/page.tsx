'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import { FormField } from '@/components/ui/form-field';
import { preset30JoursRange } from '@/lib/registre-presets';

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

function RegistreContent() {
  const router = useRouter();
  const [rows, setRows] = useState<RegistreRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filtres
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flux, setFlux] = useState<string[]>([]);
  const [lieu, setLieu] = useState('');
  const [traiteur, setTraiteur] = useState('');
  const [bordereau, setBordereau] = useState<'' | 'dispo' | 'manquant'>('');
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
      if (lieu) qs.set('lieu', lieu);
      if (traiteur) qs.set('traiteur', traiteur);
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
      lieu,
      traiteur,
      bordereau,
      sortBy,
      sortDir,
      page,
      pageSize,
    ],
  );

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/registre?${queryString(false)}`)
      .then((r) => r.json())
      .then((j: { rows?: RegistreRow[]; total?: number }) => {
        setRows(j.rows ?? []);
        setTotal(j.total ?? 0);
      })
      .finally(() => setLoading(false));
  }, [queryString]);

  // Options lieu / traiteur dérivées des lignes chargées (V1 sans endpoint dédié).
  const lieuxOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows)
      if (r.lieu_id && r.lieu_nom) m.set(r.lieu_id, r.lieu_nom);
    return [...m.entries()];
  }, [rows]);
  const traiteursOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows)
      if (r.traiteur_operationnel_organisation_id && r.traiteur_raison_sociale)
        m.set(
          r.traiteur_operationnel_organisation_id,
          r.traiteur_raison_sociale,
        );
    return [...m.entries()];
  }, [rows]);

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
  const SortHead = ({ k, label }: { k: SortKey; label: string }) => (
    <th className="px-3 py-2">
      <button
        type="button"
        className="flex items-center gap-1 font-medium"
        onClick={() => sort(k)}
      >
        {label}
        {sortBy === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}
      </button>
    </th>
  );

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

      {/* Barre de filtres — pattern DS `FilterBar` : un FormField + un
          contrôle par filtre, grille de 3 colonnes. */}
      <FilterBar
        data-testid="registre-filtres"
        actif={
          from !== '' ||
          to !== '' ||
          flux.length > 0 ||
          lieu !== '' ||
          traiteur !== '' ||
          bordereau !== ''
        }
        onReset={() => {
          setPage(1);
          setFrom('');
          setTo('');
          setFlux([]);
          setLieu('');
          setTraiteur('');
          setBordereau('');
        }}
      >
        <FormField label="Période" htmlFor="registre-periode">
          <DateRangePicker
            id="registre-periode"
            data-testid="registre-periode"
            value={{ from, to }}
            onChange={(p) => {
              setPage(1);
              setFrom(p.from);
              setTo(p.to);
            }}
          />
          {/* BL-P3-10 — Preset « 30 derniers jours » (CDC §06.03). Applique la
              fenêtre au clic ; le défaut au chargement reste vide (historique
              complet), arbitrage Val R23c. */}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            data-testid="registre-preset-30j"
            onClick={() => {
              setPage(1);
              const r = preset30JoursRange();
              setFrom(r.from);
              setTo(r.to);
            }}
          >
            30 derniers jours
          </Button>
        </FormField>
        <FormField label="Lieu" htmlFor="registre-lieu">
          <Combobox
            id="registre-lieu"
            data-testid="registre-lieu"
            placeholder="Tous"
            searchPlaceholder="Rechercher un lieu…"
            options={[
              { value: '', label: 'Tous' },
              ...lieuxOptions.map(([id, nom]) => ({ value: id, label: nom })),
            ]}
            value={lieu}
            onChange={(v) => {
              setPage(1);
              setLieu(v);
            }}
          />
        </FormField>
        <FormField label="Traiteur" htmlFor="registre-traiteur">
          <Combobox
            id="registre-traiteur"
            data-testid="registre-traiteur"
            icon={null}
            placeholder="Tous"
            searchPlaceholder="Rechercher un traiteur…"
            options={[
              { value: '', label: 'Tous' },
              ...traiteursOptions.map(([id, nom]) => ({
                value: id,
                label: nom,
              })),
            ]}
            value={traiteur}
            onChange={(v) => {
              setPage(1);
              setTraiteur(v);
            }}
          />
        </FormField>
        <FormField label="Bordereau" htmlFor="registre-bordereau">
          <Combobox
            id="registre-bordereau"
            data-testid="registre-bordereau"
            icon={null}
            placeholder="Tous"
            options={[
              { value: '', label: 'Tous' },
              { value: 'dispo', label: 'Disponible' },
              { value: 'manquant', label: 'Manquant' },
            ]}
            value={bordereau}
            onChange={(v) => {
              setPage(1);
              setBordereau(v as '' | 'dispo' | 'manquant');
            }}
          />
        </FormField>
        <FormField label="Flux" htmlFor="registre-flux">
          <Combobox
            multiple
            id="registre-flux"
            data-testid="registre-flux"
            icon={null}
            placeholder="Tous"
            options={FLUX_ORDER.map((code) => ({
              value: code,
              label: FLUX_LABELS[code] ?? code,
            }))}
            value={flux}
            onChange={(codes) => {
              setPage(1);
              setFlux(codes);
            }}
          />
        </FormField>
      </FilterBar>

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">
          Aucune collecte au registre pour ces critères.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <SortHead k="date_evenement" label="Date événement" />
                <SortHead k="lieu_nom" label="Lieu" />
                <SortHead k="traiteur_raison_sociale" label="Traiteur" />
                <th className="px-3 py-2">Flux</th>
                <SortHead k="poids_total_kg" label="Poids total" />
                <SortHead k="exutoire_nom" label="Exutoire" />
                <th className="px-3 py-2">Bordereau</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.collecte_id}
                  className="cursor-pointer border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                  onClick={() => router.push(`/registre/${r.collecte_id}`)}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    {dateFr(r.date_evenement)}
                    {r.historique_partiel && (
                      <span
                        className="ml-1"
                        title="Historique partiel (migration incomplète)"
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.lieu_nom ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.traiteur_raison_sociale ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(r.flux_codes ?? []).map((c) => (
                        <Badge key={c} variant="neutral">
                          {FLUX_LABELS[c] ?? c}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {poidsFr(r.poids_total_kg)}
                  </td>
                  <td className="px-3 py-2">{r.exutoire_nom ?? '—'}</td>
                  <td
                    className="px-3 py-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.bordereau_id && bordereauDispo(r.bordereau_statut) ? (
                      <button
                        type="button"
                        className="text-savr-primary-700 underline"
                        onClick={() => downloadBordereau(r.bordereau_id!)}
                      >
                        {r.bordereau_numero ?? 'PDF'} ⬇
                      </button>
                    ) : (
                      <span className="text-savr-neutral-400">Manquant</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
