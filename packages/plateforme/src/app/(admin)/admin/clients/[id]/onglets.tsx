'use client';

/**
 * Onglets de la fiche organisation (BL-P1-BOA-08, §06.06 §8).
 *
 * Câble les 5 onglets restés en « À venir » : Collectes, Factures, Grille
 * tarifaire ZD, Tarif refacturé, Coefficient de perte labo — sur les APIs admin
 * existantes. Les 3 derniers sont réservés aux traiteurs (filtre `ongletsVisibles`
 * côté page) ; leur ÉCRITURE est admin-only (§09 §144 + §359-367 + §293) → un
 * `ops_savr` voit un bandeau « Lecture seule — édition réservée admin » et les
 * actions d'édition sont désactivées. La sécurité réelle reste côté serveur
 * (routes `requireAdmin`).
 *
 * Composants séparés (pas dans page.tsx) : un export nommé arbitraire dans un
 * fichier `page.tsx` casse `next build` (leçon R17 sl1).
 *
 * Restyle Design System (§10, revue E2E) : formulaires en Input/Combobox/DatePicker/Textarea +
 * Label, dialogues en Modal, bandeaux d'erreur en AlertBar, couleurs = tokens
 * `savr-*`. L'onglet Collectes utilise la Data Table commune des listes
 * Collectes (DataGrid, 2026-09-28) ; l'onglet Factures reste sur DataTable.
 */

import { ListFooter } from '@/components/ui/list-footer';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, CreditCard, FlaskConical, Percent } from 'lucide-react';
import { OpsReadOnlyBanner } from '@/components/ui/ops-read-only-banner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { DataTable, type Column } from '@/components/ui/data-table';
import {
  DataGrid,
  type ColumnDef,
  type SortingState,
} from '@/components/ui/data-grid';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { FactureStatutBadge } from '@/components/ui/facture-statut-badge';
import { libelleCourtTypeFacture } from '@/lib/libelles/facture';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { statutCollecteAdmin } from '@/lib/statut-collecte-admin';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { FormField } from '@/components/ui/form-field';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { formatDateParis, jourParis } from '@savr/shared/src/temps/index.js';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { fmtEuro, fmtDec } from '@/lib/format';
import { FormActions } from '@/components/ui/form-actions';
import { ROUTES } from '@/lib/routes';

// ── Bandeau lecture seule ops ────────────────────────────────────────────────
// OpsReadOnlyBanner extrait en composant partagé (R18, importé en tête) —
// réutilisé par les écrans Paramètres §9.

// ── Onglet Collectes ─────────────────────────────────────────────────────────

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  // Signaux « demande partie » : séparent « Créée » de « Programmée »
  // (lib/statut-collecte-admin), servis par GET /admin/collectes.
  statut_tms: string;
  tms_reference: string | null;
  prestataire_logistique_id: string | null;
  attributions_antgaspi: unknown;
  date_collecte: string | null;
  heure_collecte?: string | null;
  evenements: {
    nom_evenement: string | null;
    pax: number | null;
    lieux: { nom: string; ville: string | null } | null;
  } | null;
}

export function OngletCollectes({
  organisationId,
}: {
  organisationId: string;
}): React.ReactElement {
  const router = useRouter();
  // Même Data Table que la liste Collectes (décision Val 2026-09-28). Tri
  // envoyé à l'API (`tri`/`ordre`, liste blanche côté route) : elle ne renvoie
  // qu'une page, trier côté client la seule page reçue donnerait un ordre faux.
  // Liste PAGINÉE (R-UI-4a, E5) : avant, seule la 1re page (50) était chargée
  // et le reste de l'historique restait invisible, sans compteur ni pagination.
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: 'date', desc: true },
  ]);
  const [page, setPage] = React.useState(1);
  const tri = sorting[0];
  const url = React.useMemo(() => {
    const qs = new URLSearchParams({
      organisation_id: organisationId,
      page: String(page),
    });
    if (tri) {
      qs.set('tri', tri.id);
      qs.set('ordre', tri.desc ? 'desc' : 'asc');
    }
    return `/api/v1/admin/collectes?${qs}`;
  }, [organisationId, page, tri?.id, tri?.desc]);
  const {
    data: rows,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<CollecteRow>(url);

  const columns: ColumnDef<CollecteRow, unknown>[] = [
    {
      id: 'date',
      header: 'Date',
      enableHiding: false,
      accessorFn: (row) => row.date_collecte ?? '',
      cell: ({ row: { original: row } }) =>
        row.date_collecte ? (
          <span className="whitespace-nowrap font-semibold tabular-nums">
            {libelleDateHeure(row.date_collecte, row.heure_collecte ?? null)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'type',
      header: 'Type',
      accessorFn: (row) => row.type,
      cell: ({ row: { original: row } }) => (
        <TypeCollecteBadge type={row.type} />
      ),
    },
    {
      id: 'evenement',
      header: 'Événement',
      cell: ({ row: { original: row } }) => (
        <span className="font-medium text-savr-primary-700">
          {row.evenements?.nom_evenement ?? '—'}
        </span>
      ),
    },
    {
      id: 'lieu',
      header: 'Lieu',
      cell: ({ row: { original: row } }) => {
        const l = row.evenements?.lieux;
        if (!l) return '—';
        return l.ville ? `${l.nom} — ${l.ville}` : l.nom;
      },
    },
    {
      id: 'pax',
      header: 'Pax',
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: row } }) => row.evenements?.pax ?? '—',
    },
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (row) => row.statut,
      cell: ({ row: { original: row } }) => (
        <CollecteStatutBadge statut={statutCollecteAdmin(row)} vue="admin" />
      ),
    },
  ];

  // Squelette au 1er chargement seulement : un re-tri garde le tableau (et
  // ses en-têtes) à l'écran pendant l'aller-retour serveur.
  if (loading && rows.length === 0 && !erreur)
    return <LoadingState variant="bloc" />;
  if (!loading && !erreur && rows.length === 0)
    return (
      <Card padding="lg">
        <EmptyState
          icon={<BarChart3 />}
          title="Aucune collecte"
          description="Cette organisation n'a aucune collecte enregistrée."
        />
      </Card>
    );

  return (
    <Card padding="sm">
      <DataGrid
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        erreur={erreur}
        onRecharger={recharger}
        toolbar={
          total > 0 ? (
            <Text as="span">
              {total} collecte{total > 1 ? 's' : ''}
            </Text>
          ) : null
        }
        manualSorting
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next);
          setPage(1);
        }}
        onRowClick={(row) => router.push(ROUTES.admin.collecte(row.id))}
        rowLabel={(row) =>
          `Ouvrir la collecte${row.evenements?.nom_evenement ? ` ${row.evenements.nom_evenement}` : ''}`
        }
      />
      <ListFooter total={total} page={page} onPageChange={setPage} />
    </Card>
  );
}

// ── Onglet Factures ──────────────────────────────────────────────────────────

interface FactureRow {
  id: string;
  numero_facture: string | null;
  type: string | null;
  statut: string;
  montant_ttc: number | null;
  date_emission: string | null;
}

export function OngletFactures({
  organisationId,
}: {
  organisationId: string;
}): React.ReactElement {
  const router = useRouter();
  const [rows, setRows] = React.useState<FactureRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/v1/admin/factures?organisation_id=${organisationId}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: FactureRow[] }) => {
        if (!cancelled) setRows(j.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  const columns: Column<FactureRow>[] = [
    {
      key: 'numero_facture',
      header: 'Numéro',
      render: (row) => (
        <span className="font-medium text-savr-primary-700">
          {row.numero_facture ?? '— brouillon —'}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => libelleCourtTypeFacture(row.type),
    },
    {
      key: 'statut',
      header: 'Statut',
      render: (row) => <FactureStatutBadge statut={row.statut} />,
    },
    {
      key: 'montant_ttc',
      header: 'Montant TTC',
      render: (row) =>
        row.montant_ttc != null ? fmtEuro(row.montant_ttc) : '—',
    },
    {
      key: 'date_emission',
      header: 'Émise le',
      render: (row) =>
        row.date_emission
          ? new Date(row.date_emission).toLocaleDateString('fr-FR', {
              timeZone: 'Europe/Paris',
            })
          : '—',
    },
  ];

  if (loading) return <LoadingState variant="bloc" />;
  if (rows.length === 0)
    return (
      <Card padding="lg">
        <EmptyState
          icon={<CreditCard />}
          title="Aucune facture"
          description="Cette organisation n'a aucune facture."
        />
      </Card>
    );

  return (
    <Card padding="sm">
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(row) => row.id}
        onRowClick={(row) => router.push(ROUTES.admin.facture(row.id))}
      />
    </Card>
  );
}

// ── Onglet Grille tarifaire ZD (traiteur only, édition admin-only) ───────────

interface Palier {
  id: string;
  pax_min: number;
  pax_max: number | null;
  prix_base_ht: number | null;
  prix_par_couvert_ht: number | null;
}
interface Grille {
  id: string;
  nom: string;
  description: string | null;
  est_defaut: boolean;
  tarifs_zero_dechet: Palier[];
}

const euros = (v: number | null): string => (v != null ? fmtEuro(v) : '—');

// Paliers de la grille affectée. Pax max absent = palier ouvert (∞), trié en
// dernier ; prix absent (undefined) = renvoyé en fin de tri.
const COLONNES_PALIERS: ColumnDef<Palier, unknown>[] = [
  {
    id: 'pax_min',
    header: 'Pax min',
    accessorFn: (p) => p.pax_min,
    cell: ({ row: { original: p } }) => p.pax_min,
  },
  {
    id: 'pax_max',
    header: 'Pax max',
    accessorFn: (p) => p.pax_max ?? Number.POSITIVE_INFINITY,
    cell: ({ row: { original: p } }) => p.pax_max ?? '∞',
  },
  {
    id: 'prix_base_ht',
    header: 'Prix base HT',
    accessorFn: (p) => p.prix_base_ht ?? undefined,
    cell: ({ row: { original: p } }) => euros(p.prix_base_ht),
  },
  {
    id: 'prix_par_couvert_ht',
    header: 'Prix / couvert HT',
    accessorFn: (p) => p.prix_par_couvert_ht ?? undefined,
    cell: ({ row: { original: p } }) => euros(p.prix_par_couvert_ht),
  },
];

export function OngletGrilleZd({
  organisationId,
  grilleId,
  canEdit,
  onUpdated,
}: {
  organisationId: string;
  grilleId: string | null;
  canEdit: boolean;
  onUpdated: () => void;
}): React.ReactElement {
  const [grilles, setGrilles] = React.useState<Grille[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch('/api/v1/admin/grilles-tarifaires-zd')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: Grille[] }) => {
        if (!cancelled) setGrilles(j.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setGrilles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Grille affectée (ou grille par défaut si aucune n'est affectée).
  const affectee =
    grilles.find((g) => g.id === grilleId) ??
    grilles.find((g) => g.est_defaut) ??
    null;

  async function changerGrille(nouvelleId: string) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grille_tarifaire_zd_id: nouvelleId === '' ? null : nouvelleId,
          }),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Erreur');
        return;
      }
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState variant="bloc" />;

  return (
    <Card padding="lg" className="space-y-4">
      {!canEdit && <OpsReadOnlyBanner />}

      <div>
        {/* htmlFor seulement quand la liste existe (mode édition) — évite une
            association pendante vers un id absent en lecture seule. */}
        <Label htmlFor={canEdit ? 'grille-zd-select' : undefined}>
          Grille tarifaire ZD affectée
        </Label>
        {canEdit ? (
          <Combobox
            id="grille-zd-select"
            aria-label="Grille tarifaire ZD"
            icon={null}
            placeholder="— Aucune grille spécifique (défaut appliqué) —"
            options={[
              {
                value: '',
                label: '— Aucune grille spécifique (défaut appliqué) —',
              },
              ...grilles.map((g) => ({
                value: g.id,
                label: g.nom + (g.est_defaut ? ' (grille par défaut)' : ''),
              })),
            ]}
            value={grilleId ?? ''}
            disabled={saving}
            onChange={(v) => void changerGrille(v)}
            className="max-w-md"
          />
        ) : (
          <p className="text-sm">
            {affectee ? affectee.nom : 'Grille par défaut'}
            {affectee?.est_defaut && !grilleId ? ' (défaut)' : ''}
          </p>
        )}
        {!grilleId && (
          <Text variant="hint" className="mt-1">
            Aucune grille spécifique — la grille par défaut « Standard paliers »
            s'applique.
          </Text>
        )}
        {error && (
          <AlertBar variant="err" className="mt-2 font-normal">
            {error}
          </AlertBar>
        )}
      </div>

      {affectee && affectee.tarifs_zero_dechet.length > 0 && (
        <div>
          <Heading
            level={3}
            size="sm"
            weight="medium"
            tone="inherit"
            className="mb-2"
          >
            Paliers — {affectee.nom}
          </Heading>
          {/* Liste complète des paliers de la grille (route sans pagination)
              → tri navigateur ; ordre par défaut = pax min croissant. */}
          <DataGrid
            columnsToggle={false}
            columns={COLONNES_PALIERS}
            data={affectee.tarifs_zero_dechet}
            getRowId={(p) => p.id}
            initialSorting={[{ id: 'pax_min', desc: false }]}
          />
        </div>
      )}
    </Card>
  );
}

// ── Onglet Tarif refacturé (traiteur only, édition admin-only) ───────────────

export function OngletTarifRefacture({
  organisationId,
  value,
  canEdit,
  onUpdated,
}: {
  organisationId: string;
  value: number | null;
  canEdit: boolean;
  onUpdated: () => void;
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false);
  const [input, setInput] = React.useState(String(value ?? ''));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(input);
    if (isNaN(num) || num < 0) {
      setError('Valeur invalide (≥ 0 requis)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tarif_refacture_pax_zd: num }),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Erreur');
        return;
      }
      setEditing(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card padding="lg" className="space-y-4 max-w-xl">
      {!canEdit && <OpsReadOnlyBanner />}
      <div>
        {/* htmlFor seulement quand l'<input> existe (mode édition) — évite une
            association pendante vers un id absent en lecture seule. */}
        <Label
          htmlFor={editing && canEdit ? 'tarif-refacture-input' : undefined}
        >
          Tarif refacturé client final ZD (€/pax)
        </Label>
        <Text variant="hint" className="mb-3">
          Tarif que ce traiteur refacture à son client final par couvert sur ses
          collectes ZD. Sert au calcul de sa marge affichée dans son dashboard.
        </Text>

        {editing && canEdit ? (
          <form onSubmit={(e) => void save(e)} className="flex items-end gap-2">
            <Input
              id="tarif-refacture-input"
              type="number"
              min={0}
              step="0.01"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Tarif refacturé (€/pax)"
              className="w-40"
            />
            <Button
              type="submit"
              size="sm"
              loading={saving}
              loadingText="Enregistrement…"
            >
              Enregistrer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setInput(String(value ?? ''));
                setError(null);
              }}
            >
              Annuler
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-4">
            <span className="text-lg font-semibold text-savr-neutral-900">
              {value != null ? fmtEuro(value) : '1,50 € (défaut)'}
            </span>
            {canEdit && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditing(true)}
              >
                Modifier
              </Button>
            )}
          </div>
        )}
        {error && (
          <AlertBar variant="err" className="mt-2 font-normal">
            {error}
          </AlertBar>
        )}
      </div>
    </Card>
  );
}

// ── Onglet Coefficient de perte labo (traiteur only, édition admin-only) ─────

interface Coefficient {
  id: string;
  annee_reference: number;
  // annee_application = annee_reference + 1, calculée côté serveur (CDC §9bis.1).
  annee_application?: number;
  coefficient_kg_couvert: number;
  source_commentaire: string | null;
  saisi_par_user: { prenom: string; nom: string } | null;
  saisi_le: string;
}

type CoefModal =
  | { mode: 'ajouter' }
  | { mode: 'editer'; coef: Coefficient }
  | null;

const nomAuteur = (u: { prenom: string; nom: string } | null): string =>
  u ? `${u.prenom} ${u.nom}` : '—';

// Colonne d'action « Éditer » présente seulement quand l'édition est permise.
function colonnesCoefficients(
  canEdit: boolean,
  onEditer: (c: Coefficient) => void,
): ColumnDef<Coefficient, unknown>[] {
  const colonnes: ColumnDef<Coefficient, unknown>[] = [
    {
      id: 'annee_reference',
      header: 'Année de référence',
      accessorFn: (c) => c.annee_reference,
      meta: { className: 'font-medium' },
      cell: ({ row: { original: c } }) => c.annee_reference,
    },
    {
      id: 'coefficient',
      header: 'Coefficient (kg/couvert)',
      accessorFn: (c) => c.coefficient_kg_couvert,
      cell: ({ row: { original: c } }) => fmtDec(c.coefficient_kg_couvert, 4),
    },
    {
      id: 'annee_application',
      header: 'Appliqué aux événements de',
      accessorFn: (c) => c.annee_application ?? c.annee_reference + 1,
      cell: ({ row: { original: c } }) =>
        c.annee_application ?? c.annee_reference + 1,
    },
    {
      id: 'source',
      header: 'Source / commentaire',
      accessorFn: (c) => c.source_commentaire ?? '',
      meta: { className: 'text-savr-neutral-500' },
      cell: ({ row: { original: c } }) => c.source_commentaire ?? '—',
    },
    {
      id: 'saisi_par',
      header: 'Saisi par',
      accessorFn: (c) => nomAuteur(c.saisi_par_user),
      meta: { className: 'text-savr-neutral-500' },
      cell: ({ row: { original: c } }) => nomAuteur(c.saisi_par_user),
    },
    {
      id: 'saisi_le',
      header: 'Saisi le',
      accessorFn: (c) => c.saisi_le,
      meta: { className: 'text-savr-neutral-500' },
      cell: ({ row: { original: c } }) => formatDateParis(c.saisi_le),
    },
  ];
  if (canEdit) {
    colonnes.push({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: { label: 'Actions', interactive: true, className: 'text-right' },
      cell: ({ row: { original: c } }) => (
        <Button size="sm" variant="secondary" onClick={() => onEditer(c)}>
          Éditer
        </Button>
      ),
    });
  }
  return colonnes;
}

export function OngletCoefficients({
  organisationId,
  canEdit,
}: {
  organisationId: string;
  canEdit: boolean;
}): React.ReactElement {
  const [coefs, setCoefs] = React.useState<Coefficient[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [modal, setModal] = React.useState<CoefModal>(null);
  const [fAnnee, setFAnnee] = React.useState(new Date().getFullYear() - 1);
  const [fCoef, setFCoef] = React.useState('');
  const [fSource, setFSource] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    setLoading(true);
    void fetch(
      `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}/coefficients-perte-labo`,
    )
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: Coefficient[] }) => setCoefs(j.data ?? []))
      .catch(() => setCoefs([]))
      .finally(() => setLoading(false));
  }, [organisationId]);

  React.useEffect(() => {
    load();
  }, [load]);

  function openAjouter() {
    setModal({ mode: 'ajouter' });
    setFAnnee(new Date().getFullYear() - 1);
    setFCoef('');
    setFSource('');
    setError(null);
  }
  function openEditer(coef: Coefficient) {
    setModal({ mode: 'editer', coef });
    setFAnnee(coef.annee_reference);
    setFCoef(String(coef.coefficient_kg_couvert));
    setFSource(coef.source_commentaire ?? '');
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    const coefNum = Number(fCoef);
    if (isNaN(coefNum) || coefNum < 0) {
      setError('Coefficient invalide (≥ 0 requis)');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r =
        modal.mode === 'ajouter'
          ? await fetch(
              `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}/coefficients-perte-labo`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  annee_reference: fAnnee,
                  coefficient_kg_couvert: coefNum,
                  source_commentaire: fSource || undefined,
                }),
              },
            )
          : await fetch(
              `/api/v1/admin/coefficients-perte-labo/${encodeURIComponent(modal.coef.id)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  coefficient_kg_couvert: coefNum,
                  source_commentaire: fSource || undefined,
                }),
              },
            );
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(j.error ?? 'Erreur');
        return;
      }
      setModal(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState variant="bloc" />;

  return (
    <Card padding="lg" className="space-y-4">
      {!canEdit && <OpsReadOnlyBanner />}

      <div className="flex items-center justify-between">
        <Heading level={3} size="sm" weight="medium" tone="inherit">
          Coefficients de perte labo
        </Heading>
        {canEdit && (
          <Button size="sm" onClick={openAjouter}>
            Ajouter un coefficient
          </Button>
        )}
      </div>

      {coefs.length === 0 ? (
        <EmptyState
          icon={<FlaskConical />}
          title="Aucun coefficient communiqué"
          description="Aucun coefficient de perte labo n'a été saisi pour ce traiteur."
        />
      ) : (
        // Liste complète (route sans pagination, triée par année desc) → tri
        // navigateur, ordre par défaut identique à celui de l'API.
        <DataGrid
          columnsToggle={false}
          columns={colonnesCoefficients(canEdit, openEditer)}
          data={coefs}
          getRowId={(c) => c.id}
          initialSorting={[{ id: 'annee_reference', desc: true }]}
        />
      )}

      {modal && (
        <Modal
          open
          title={
            modal.mode === 'ajouter'
              ? 'Ajouter un coefficient'
              : 'Éditer le coefficient'
          }
          onClose={() => setModal(null)}
          footer={
            <FormActions
              cancel={{ label: 'Annuler', onClick: () => setModal(null) }}
              submit={{ label: 'Enregistrer', form: 'coef-form' }}
              loading={saving}
              loadingText="Enregistrement…"
            />
          }
        >
          {error && (
            <AlertBar variant="err" className="mb-4">
              {error}
            </AlertBar>
          )}
          <form
            id="coef-form"
            onSubmit={(e) => void submit(e)}
            className="space-y-4"
          >
            <div>
              <Label htmlFor="coef-annee">Année de référence</Label>
              <Input
                id="coef-annee"
                type="number"
                min={2020}
                max={2100}
                value={fAnnee}
                disabled={modal.mode === 'editer'}
                aria-label="Année de référence"
                onChange={(e) =>
                  setFAnnee(parseInt(e.target.value, 10) || fAnnee)
                }
                required
              />
            </div>
            <div>
              <Label htmlFor="coef-valeur">Coefficient (kg/couvert)</Label>
              <Input
                id="coef-valeur"
                type="number"
                min={0}
                step="0.0001"
                value={fCoef}
                aria-label="Coefficient (kg/couvert)"
                onChange={(e) => setFCoef(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="coef-source">Source / commentaire</Label>
              <Textarea
                id="coef-source"
                value={fSource}
                onChange={(e) => setFSource(e.target.value)}
                rows={2}
                placeholder="Optionnel"
              />
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

// ── Onglet Remises négociées (écriture admin-only) ──────────────────────────

interface Remise {
  id: string;
  activite: string;
  remise_pct: number; // FRACTION 0..1 (0.15 = 15 %)
  valide_du: string;
  valide_jusqu_au: string | null;
  scope: string;
  commentaires: string | null;
  lieu_id?: string | null;
  lieux?: { nom: string } | null;
}

// Portée affichée sur la fiche gestionnaire (colonne « Lieux concernés »).
const porteeRemise = (r: Remise): string =>
  r.scope === 'gestionnaire'
    ? (r.lieux?.nom ?? 'Tous ses lieux')
    : 'Organisation (en direct)';

// Fiche gestionnaire de lieux : la remise est portée par le gestionnaire
// (scope=gestionnaire) et s'applique à toutes les collectes sur ses lieux, quel
// que soit le traiteur (§05 résolution du prix). Autres fiches : scope=organisation.
export function OngletRemises({
  organisationId,
  organisationType,
  lieuxGestionnaire,
  remises,
  canEdit,
  onUpdated,
}: {
  organisationId: string;
  organisationType: string;
  lieuxGestionnaire: { id: string; nom: string }[];
  remises: Remise[];
  canEdit: boolean;
  onUpdated: () => void;
}): React.ReactElement {
  const estGestionnaire = organisationType === 'gestionnaire_lieux';
  const [modal, setModal] = React.useState(false);
  // Remise en cours de modification (null = création). Modifier = fermer la
  // ligne active + créer la suivante côté serveur (§06.06, jamais rétroactif).
  const [edition, setEdition] = React.useState<Remise | null>(null);
  const [fActivite, setFActivite] = React.useState('zd');
  // Lieux cochés (vide = tous les lieux du gestionnaire). Une remise par lieu.
  const [fLieuIds, setFLieuIds] = React.useState<string[]>([]);
  const [fPct, setFPct] = React.useState('');
  const [fValideDu, setFValideDu] = React.useState('');
  const [fCommentaires, setFCommentaires] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [closingId, setClosingId] = React.useState<string | null>(null);
  const [activesOnly, setActivesOnly] = React.useState(false);

  const displayed = activesOnly
    ? remises.filter((r) => !r.valide_jusqu_au)
    : remises;

  function openCreer() {
    setModal(true);
    setEdition(null);
    setFActivite('zd');
    setFLieuIds([]);
    setFPct('');
    setFValideDu('');
    setFCommentaires('');
    setError(null);
  }

  function openModifier(r: Remise) {
    setModal(true);
    setEdition(r);
    setFActivite(r.activite);
    setFLieuIds(r.lieu_id ? [r.lieu_id] : []);
    setFPct(String(Math.round(r.remise_pct * 10000) / 100));
    setFValideDu(dateEffetMin(r));
    setFCommentaires(r.commentaires ?? '');
    setError(null);
  }

  // Date d'effet d'une modification : jamais passée, jamais avant le début de la
  // remise remplacée (contrôlé aussi côté serveur).
  function dateEffetMin(r: Remise): string {
    const today = jourParis();
    return r.valide_du > today ? r.valide_du : today;
  }

  // Lieu modifiable uniquement pour une remise portée par le gestionnaire.
  const afficherLieu = edition
    ? edition.scope === 'gestionnaire'
    : estGestionnaire;

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(fPct);
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      setError('Remise invalide (> 0 et ≤ 100 %)');
      return;
    }
    if (!fValideDu) {
      setError('Date « valide du » requise');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = edition
        ? await fetch(
            `/api/v1/admin/tarifs-negocie/${encodeURIComponent(edition.id)}/modifier`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...(edition.scope === 'gestionnaire'
                  ? { lieu_ids: fLieuIds }
                  : {}),
                remise_pct: pct / 100,
                valide_du: fValideDu,
                commentaires: fCommentaires || null,
              }),
            },
          )
        : await fetch('/api/v1/admin/tarifs-negocie', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(estGestionnaire
                ? {
                    scope: 'gestionnaire',
                    gestionnaire_organisation_id: organisationId,
                    lieu_ids: fLieuIds,
                  }
                : { scope: 'organisation', organisation_id: organisationId }),
              activite: fActivite,
              remise_pct: pct / 100, // % → fraction 0..1
              valide_du: fValideDu,
              commentaires: fCommentaires || undefined,
            }),
          });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(j.error ?? 'Erreur');
        return;
      }
      setModal(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  async function fermer(id: string) {
    setClosingId(id);
    try {
      const r = await fetch(
        `/api/v1/admin/tarifs-negocie/${encodeURIComponent(id)}/fermer`,
        {
          method: 'POST',
        },
      );
      if (r.ok) onUpdated();
    } finally {
      setClosingId(null);
    }
  }

  const colonnesRemises: ColumnDef<Remise, unknown>[] = [
    {
      id: 'activite',
      header: 'Activité',
      accessorFn: (r) => r.activite ?? '',
      cell: ({ row: { original: r } }) =>
        r.activite ? r.activite.toUpperCase() : '—',
    },
    {
      id: 'remise',
      header: 'Remise',
      accessorFn: (r) => r.remise_pct,
      meta: { className: 'font-medium' },
      cell: ({ row: { original: r } }) => (
        <>
          {(r.remise_pct * 100).toLocaleString('fr-FR', {
            maximumFractionDigits: 2,
          })}{' '}
          %
        </>
      ),
    },
    {
      id: 'valide_du',
      header: 'Valide du',
      accessorFn: (r) => r.valide_du,
      meta: { className: 'text-savr-neutral-500' },
      cell: ({ row: { original: r } }) => formatDateParis(r.valide_du),
    },
    {
      id: 'valide_jusqu_au',
      header: "Jusqu'au",
      // Remise active (sans fin) = la plus lointaine : triée après les dates.
      accessorFn: (r) => r.valide_jusqu_au ?? '9999-12-31',
      meta: { className: 'text-savr-neutral-500' },
      cell: ({ row: { original: r } }) =>
        r.valide_jusqu_au ? (
          formatDateParis(r.valide_jusqu_au)
        ) : (
          <Badge variant="success">Active</Badge>
        ),
    },
    {
      id: 'commentaires',
      header: 'Commentaire',
      accessorFn: (r) => r.commentaires ?? '',
      meta: { className: 'text-savr-neutral-500' },
      cell: ({ row: { original: r } }) => r.commentaires ?? '—',
    },
  ];
  if (estGestionnaire) {
    colonnesRemises.splice(1, 0, {
      id: 'lieux',
      header: 'Lieux concernés',
      accessorFn: porteeRemise,
      cell: ({ row: { original: r } }) => porteeRemise(r),
    });
  }
  if (canEdit) {
    colonnesRemises.push({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: { label: 'Actions', interactive: true, className: 'text-right' },
      cell: ({ row: { original: r } }) =>
        !r.valide_jusqu_au ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              void fermer(r.id);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            loading={closingId === r.id}
            loadingText="Fermeture…"
          >
            Fermer
          </Button>
        ) : null,
    });
  }

  return (
    <Card padding="lg" className="space-y-4">
      {!canEdit && <OpsReadOnlyBanner />}

      <div className="flex items-center justify-between">
        <Heading level={3} size="sm" weight="medium" tone="inherit">
          Remises négociées
        </Heading>
        <div className="flex items-center gap-4">
          {/* Filtre « Actives uniquement » : Checkbox du DS (R-UI-4b, D11). */}
          <Label
            variant="choice"
            htmlFor="remises-actives-only"
            className="flex items-center gap-2 text-savr-neutral-600"
          >
            <Checkbox
              id="remises-actives-only"
              checked={activesOnly}
              onCheckedChange={(v) => setActivesOnly(v === true)}
            />
            Actives uniquement
          </Label>
          {canEdit && (
            <Button size="sm" onClick={openCreer}>
              Créer une remise
            </Button>
          )}
        </div>
      </div>

      {remises.length === 0 ? (
        <EmptyState
          icon={<Percent />}
          title="Aucune remise négociée"
          description={
            estGestionnaire
              ? "Aucune remise n'est appliquée aux collectes sur les lieux de ce gestionnaire."
              : "Aucune remise n'a été accordée à cette organisation."
          }
        />
      ) : (
        // Liste complète (embarquée dans la fiche organisation, sans
        // pagination) → tri navigateur. Seules les remises actives sont
        // modifiables (clic ligne) quand l'édition est permise.
        <DataGrid
          columnsToggle={false}
          columns={colonnesRemises}
          data={displayed}
          getRowId={(r) => r.id}
          onRowClick={
            canEdit
              ? (r) => {
                  if (!r.valide_jusqu_au) openModifier(r);
                }
              : undefined
          }
          rowLabel={(r) =>
            r.valide_jusqu_au ? 'Remise fermée' : 'Modifier la remise'
          }
          rowClassName={(r) =>
            r.valide_jusqu_au ? 'cursor-default' : undefined
          }
        />
      )}

      {modal && (
        <Modal
          open
          title={edition ? 'Modifier la remise' : 'Créer une remise'}
          onClose={() => setModal(false)}
          footer={
            <FormActions
              cancel={{ label: 'Annuler', onClick: () => setModal(false) }}
              submit={{
                label: edition ? 'Enregistrer' : 'Créer',
                form: 'remise-form',
              }}
              loading={saving}
              loadingText="Enregistrement…"
            />
          }
        >
          {error && (
            <AlertBar variant="err" className="mb-4">
              {error}
            </AlertBar>
          )}
          <form
            id="remise-form"
            onSubmit={(e) => void creer(e)}
            className="space-y-4"
          >
            <FormField label="Activité" htmlFor="remise-activite">
              <Combobox
                id="remise-activite"
                aria-label="Activité"
                icon={null}
                options={[
                  { value: 'zd', label: 'Zéro déchet (ZD)' },
                  { value: 'ag', label: 'Anti-gaspi (AG)' },
                ]}
                value={fActivite}
                disabled={edition !== null}
                onChange={setFActivite}
              />
            </FormField>
            {afficherLieu && (
              <fieldset>
                <legend className="text-sm font-medium text-savr-neutral-700">
                  Lieux concernés
                </legend>
                <div className="mt-2 max-h-60 space-y-2 overflow-y-auto rounded-savr-md border border-savr-neutral-200 p-3">
                  <Label
                    variant="choice"
                    className="flex min-h-11 items-center gap-3 font-medium"
                  >
                    <Checkbox
                      checked={fLieuIds.length === 0}
                      onCheckedChange={(v) => {
                        if (v === true) setFLieuIds([]);
                      }}
                    />
                    Tous les lieux du gestionnaire
                  </Label>
                  {lieuxGestionnaire.map((l) => (
                    <Label
                      key={l.id}
                      variant="choice"
                      className="flex min-h-11 items-center gap-3"
                    >
                      <Checkbox
                        checked={fLieuIds.includes(l.id)}
                        onCheckedChange={(v) =>
                          setFLieuIds((prev) =>
                            v === true
                              ? [...prev, l.id]
                              : prev.filter((id) => id !== l.id),
                          )
                        }
                      />
                      {l.nom}
                    </Label>
                  ))}
                </div>
                <Text variant="hint" className="mt-1">
                  S&apos;applique à toutes les collectes réalisées sur ces
                  lieux, quel que soit le traiteur. Si le traiteur a sa propre
                  remise, seule la plus élevée des deux s&apos;applique.
                  {fLieuIds.length > 1 &&
                    ` Une remise sera enregistrée par lieu (${fLieuIds.length}).`}
                </Text>
              </fieldset>
            )}
            <div>
              <Label htmlFor="remise-pct">Remise (%)</Label>
              <Input
                id="remise-pct"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={fPct}
                aria-label="Remise (%)"
                onChange={(e) => setFPct(e.target.value)}
                required
              />
            </div>
            <FormField
              label={edition ? 'À partir du' : 'Valide du'}
              htmlFor="remise-valide-du"
              required
              hint={
                edition
                  ? "La remise actuelle s'arrête la veille de cette date ; elle reste dans l'historique."
                  : undefined
              }
            >
              <DatePicker
                id="remise-valide-du"
                value={fValideDu}
                min={edition ? dateEffetMin(edition) : undefined}
                aria-label={edition ? 'À partir du' : 'Valide du'}
                data-testid="remise-valide-du"
                onChange={setFValideDu}
                required
              />
            </FormField>
            <div>
              <Label htmlFor="remise-commentaire">Commentaire</Label>
              <Textarea
                id="remise-commentaire"
                value={fCommentaires}
                onChange={(e) => setFCommentaires(e.target.value)}
                rows={2}
                placeholder="Optionnel"
              />
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

// ── Historique des ajustements de crédits pack (audit_log) ──────────────────

interface PackAudit {
  id: string;
  action: string;
  old_values: { credits_initiaux?: number } | null;
  // annulation_pack range le motif dans new_values.motif (pas la colonne motif).
  new_values: { credits_initiaux?: number; motif?: string } | null;
  motif: string | null;
  created_at: string;
  auteur: { prenom: string; nom: string } | null;
}

const libelleActionPack = (a: PackAudit): string =>
  a.action === 'annulation_pack' ? 'Annulation du pack' : 'Ajustement crédits';

const creditsAvantApres = (a: PackAudit): string =>
  a.action === 'pack_ajuste_manuel' &&
  a.old_values?.credits_initiaux != null &&
  a.new_values?.credits_initiaux != null
    ? `${a.old_values.credits_initiaux} → ${a.new_values.credits_initiaux}`
    : '—';

const motifPack = (a: PackAudit): string =>
  a.motif ?? a.new_values?.motif ?? '—';

const COLONNES_AJUSTEMENTS: ColumnDef<PackAudit, unknown>[] = [
  {
    id: 'date',
    header: 'Date',
    accessorFn: (a) => a.created_at,
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: a } }) => formatDateParis(a.created_at),
  },
  {
    id: 'action',
    header: 'Action',
    accessorFn: libelleActionPack,
    cell: ({ row: { original: a } }) => libelleActionPack(a),
  },
  {
    id: 'credits',
    header: 'Crédits',
    meta: { className: 'font-medium' },
    cell: ({ row: { original: a } }) => creditsAvantApres(a),
  },
  {
    id: 'motif',
    header: 'Motif',
    accessorFn: motifPack,
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: a } }) => motifPack(a),
  },
  {
    id: 'auteur',
    header: 'Auteur',
    accessorFn: (a) => nomAuteur(a.auteur),
    meta: { className: 'text-savr-neutral-500' },
    cell: ({ row: { original: a } }) => nomAuteur(a.auteur),
  },
];

/**
 * Journal des actions manuelles sur les packs AG (ajustement crédits,
 * annulation) depuis `audit_log`. Rendu sous « Historique des packs » de
 * l'onglet Packs AG. Ne rend rien s'il n'y a aucun ajustement (pas de section
 * vide). §06.06 §8 (valeurs avant/après + motif + auteur tracés).
 */
export function PackAjustementsHistorique({
  organisationId,
}: {
  organisationId: string;
}): React.ReactElement | null {
  const [rows, setRows] = React.useState<PackAudit[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/v1/admin/packs-antgaspi/historique?organisation_id=${organisationId}`,
    )
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: PackAudit[] }) => {
        if (!cancelled) setRows(j.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organisationId]);

  if (loading || rows.length === 0) return null;

  return (
    <Card padding="lg">
      <Heading
        level={3}
        size="inherit"
        weight="medium"
        tone="inherit"
        className="mb-4"
      >
        Historique des ajustements de crédits
      </Heading>
      {/* Journal complet (route sans pagination, triée par date desc) → tri
          navigateur, ordre par défaut identique à celui de l'API. */}
      <DataGrid
        columnsToggle={false}
        columns={COLONNES_AJUSTEMENTS}
        data={rows}
        getRowId={(a) => a.id}
        initialSorting={[{ id: 'date', desc: true }]}
      />
    </Card>
  );
}
