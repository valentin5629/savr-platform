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
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BarChart3, CreditCard, FlaskConical, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, type Column } from '@/components/ui/data-table';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';

// ── Bandeau lecture seule ops ────────────────────────────────────────────────

export function OpsReadOnlyBanner(): React.ReactElement {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-savr-warning-subtle bg-savr-warning-subtle px-4 py-2.5 text-sm text-savr-warning-strong">
      <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>Lecture seule — édition réservée admin.</span>
    </div>
  );
}

// ── Onglet Collectes ─────────────────────────────────────────────────────────

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
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
  const [rows, setRows] = React.useState<CollecteRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/v1/admin/collectes?organisation_id=${organisationId}`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j: { data?: CollecteRow[] }) => {
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

  const columns: Column<CollecteRow>[] = [
    {
      key: 'date_collecte',
      header: 'Date',
      render: (row) =>
        row.date_collecte
          ? new Date(row.date_collecte).toLocaleDateString('fr-FR')
          : '—',
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <Badge variant={row.type === 'zero_dechet' ? 'success' : 'warning'}>
          {row.type === 'zero_dechet' ? 'ZD' : 'AG'}
        </Badge>
      ),
    },
    {
      key: 'evenement',
      header: 'Événement',
      render: (row) => (
        <span className="font-medium text-savr-primary-700">
          {row.evenements?.nom_evenement ?? '—'}
        </span>
      ),
    },
    {
      key: 'lieu',
      header: 'Lieu',
      render: (row) => {
        const l = row.evenements?.lieux;
        if (!l) return '—';
        return l.ville ? `${l.nom} — ${l.ville}` : l.nom;
      },
    },
    { key: 'pax', header: 'Pax', render: (row) => row.evenements?.pax ?? '—' },
    {
      key: 'statut',
      header: 'Statut',
      render: (row) => <CollecteStatutBadge statut={row.statut} vue="admin" />,
    },
  ];

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0)
    return (
      <Card className="p-6">
        <EmptyState
          icon={<BarChart3 />}
          title="Aucune collecte"
          description="Cette organisation n'a aucune collecte enregistrée."
        />
      </Card>
    );

  return (
    <Card className="p-4">
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(row) => row.id}
        onRowClick={(row) => router.push(`/admin/collectes/${row.id}`)}
      />
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

const FACTURE_STATUT: Record<
  string,
  {
    label: string;
    variant: 'neutral' | 'warning' | 'info' | 'success' | 'error';
  }
> = {
  brouillon: { label: 'Brouillon', variant: 'neutral' },
  en_attente_pennylane: { label: 'En attente', variant: 'warning' },
  emise: { label: 'Émise', variant: 'info' },
  payee: { label: 'Payée', variant: 'success' },
  annulee: { label: 'Annulée', variant: 'error' },
};

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
      render: (row) => row.type ?? '—',
    },
    {
      key: 'statut',
      header: 'Statut',
      render: (row) => {
        const s = FACTURE_STATUT[row.statut] ?? {
          label: row.statut,
          variant: 'neutral' as const,
        };
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      key: 'montant_ttc',
      header: 'Montant TTC',
      render: (row) =>
        row.montant_ttc != null
          ? `${row.montant_ttc.toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} €`
          : '—',
    },
    {
      key: 'date_emission',
      header: 'Émise le',
      render: (row) =>
        row.date_emission
          ? new Date(row.date_emission).toLocaleDateString('fr-FR')
          : '—',
    },
  ];

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (rows.length === 0)
    return (
      <Card className="p-6">
        <EmptyState
          icon={<CreditCard />}
          title="Aucune facture"
          description="Cette organisation n'a aucune facture."
        />
      </Card>
    );

  return (
    <Card className="p-4">
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(row) => row.id}
        onRowClick={(row) => router.push(`/admin/factures/${row.id}`)}
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
      const r = await fetch(`/api/v1/admin/organisations/${organisationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grille_tarifaire_zd_id: nouvelleId === '' ? null : nouvelleId,
        }),
      });
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

  if (loading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card className="p-6 space-y-4">
      {!canEdit && <OpsReadOnlyBanner />}

      <div>
        <label className="block text-sm font-medium mb-1">
          Grille tarifaire ZD affectée
        </label>
        {canEdit ? (
          <select
            aria-label="Grille tarifaire ZD"
            value={grilleId ?? ''}
            disabled={saving}
            onChange={(e) => void changerGrille(e.target.value)}
            className="w-full max-w-md border border-neutral-300 rounded-lg px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="">
              — Aucune grille spécifique (défaut appliqué) —
            </option>
            {grilles.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nom}
                {g.est_defaut ? ' (grille par défaut)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm">
            {affectee ? affectee.nom : 'Grille par défaut'}
            {affectee?.est_defaut && !grilleId ? ' (défaut)' : ''}
          </p>
        )}
        {!grilleId && (
          <p className="text-xs text-neutral-500 mt-1">
            Aucune grille spécifique — la grille par défaut « Standard paliers »
            s'applique.
          </p>
        )}
        {error && <p className="text-sm text-savr-error mt-1">{error}</p>}
      </div>

      {affectee && affectee.tarifs_zero_dechet.length > 0 && (
        <div>
          <h3 className="font-medium mb-2 text-sm">Paliers — {affectee.nom}</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="pb-2">Pax min</th>
                <th className="pb-2">Pax max</th>
                <th className="pb-2">Prix base HT</th>
                <th className="pb-2">Prix / couvert HT</th>
              </tr>
            </thead>
            <tbody>
              {[...affectee.tarifs_zero_dechet]
                .sort((a, b) => a.pax_min - b.pax_min)
                .map((p) => (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="py-2">{p.pax_min}</td>
                    <td className="py-2">{p.pax_max ?? '∞'}</td>
                    <td className="py-2">
                      {p.prix_base_ht != null
                        ? `${p.prix_base_ht.toLocaleString('fr-FR')} €`
                        : '—'}
                    </td>
                    <td className="py-2">
                      {p.prix_par_couvert_ht != null
                        ? `${p.prix_par_couvert_ht.toLocaleString('fr-FR')} €`
                        : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
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
      const r = await fetch(`/api/v1/admin/organisations/${organisationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tarif_refacture_pax_zd: num }),
      });
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
    <Card className="p-6 space-y-4 max-w-xl">
      {!canEdit && <OpsReadOnlyBanner />}
      <div>
        <label className="block text-sm font-medium mb-1">
          Tarif refacturé client final ZD (€/pax)
        </label>
        <p className="text-xs text-neutral-500 mb-3">
          Tarif que ce traiteur refacture à son client final par couvert sur ses
          collectes ZD. Sert au calcul de sa marge affichée dans son dashboard.
        </p>

        {editing && canEdit ? (
          <form onSubmit={(e) => void save(e)} className="flex items-end gap-2">
            <input
              type="number"
              min={0}
              step="0.01"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Tarif refacturé (€/pax)"
              className="w-40 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
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
            <span className="text-lg font-semibold">
              {value != null
                ? `${value.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })} €`
                : '1,50 € (défaut)'}
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
        {error && <p className="text-sm text-savr-error mt-2">{error}</p>}
      </div>
    </Card>
  );
}

// ── Onglet Coefficient de perte labo (traiteur only, édition admin-only) ─────

interface Coefficient {
  id: string;
  annee_reference: number;
  coefficient_kg_couvert: number;
  source_commentaire: string | null;
  saisi_par_user: { prenom: string; nom: string } | null;
  saisi_le: string;
}

type CoefModal =
  | { mode: 'ajouter' }
  | { mode: 'editer'; coef: Coefficient }
  | null;

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
      `/api/v1/admin/coefficients-perte-labo?organisation_id=${organisationId}`,
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
          ? await fetch('/api/v1/admin/coefficients-perte-labo', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                organisation_id: organisationId,
                annee_reference: fAnnee,
                coefficient_kg_couvert: coefNum,
                source_commentaire: fSource || undefined,
              }),
            })
          : await fetch(
              `/api/v1/admin/coefficients-perte-labo/${modal.coef.id}`,
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

  if (loading) return <Skeleton className="h-40 w-full" />;

  return (
    <Card className="p-6 space-y-4">
      {!canEdit && <OpsReadOnlyBanner />}

      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm">Coefficients de perte labo</h3>
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
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="pb-2">Année de référence</th>
              <th className="pb-2">Coefficient (kg/couvert)</th>
              <th className="pb-2">Appliqué aux événements de</th>
              <th className="pb-2">Source / commentaire</th>
              <th className="pb-2">Saisi par</th>
              <th className="pb-2">Saisi le</th>
              {canEdit && <th className="pb-2"></th>}
            </tr>
          </thead>
          <tbody>
            {coefs.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100">
                <td className="py-2 font-medium">{c.annee_reference}</td>
                <td className="py-2">
                  {c.coefficient_kg_couvert.toLocaleString('fr-FR', {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })}
                </td>
                <td className="py-2">{c.annee_reference + 1}</td>
                <td className="py-2 text-neutral-500">
                  {c.source_commentaire ?? '—'}
                </td>
                <td className="py-2 text-neutral-500">
                  {c.saisi_par_user
                    ? `${c.saisi_par_user.prenom} ${c.saisi_par_user.nom}`
                    : '—'}
                </td>
                <td className="py-2 text-neutral-500">
                  {new Date(c.saisi_le).toLocaleDateString('fr-FR')}
                </td>
                {canEdit && (
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openEditer(c)}
                    >
                      Éditer
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold mb-4">
              {modal.mode === 'ajouter'
                ? 'Ajouter un coefficient'
                : 'Éditer le coefficient'}
            </h2>
            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
                {error}
              </div>
            )}
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Année de référence
                </label>
                <input
                  type="number"
                  min={2020}
                  max={2100}
                  value={fAnnee}
                  disabled={modal.mode === 'editer'}
                  aria-label="Année de référence"
                  onChange={(e) =>
                    setFAnnee(parseInt(e.target.value, 10) || fAnnee)
                  }
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm disabled:bg-neutral-100"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Coefficient (kg/couvert)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={fCoef}
                  aria-label="Coefficient (kg/couvert)"
                  onChange={(e) => setFCoef(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Source / commentaire
                </label>
                <textarea
                  value={fSource}
                  onChange={(e) => setFSource(e.target.value)}
                  rows={2}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Optionnel"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => setModal(null)}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Card>
  );
}
