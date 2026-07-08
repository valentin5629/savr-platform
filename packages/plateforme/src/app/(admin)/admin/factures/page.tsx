'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Download } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { pastillePennylane2h, estEnRetard } from '@/lib/facturation/facture-ui';

interface Facture {
  id: string;
  numero_facture: string | null;
  type: string;
  mode_facturation: string;
  statut: string;
  pennylane_statut: string | null;
  montant_ht: number;
  montant_ttc: number;
  devise: string;
  date_emission: string | null;
  date_echeance: string | null;
  date_paiement: string | null;
  created_at: string;
  derniere_tentative_pennylane_at: string | null;
  pdf_url_savr: string | null;
  organisations: { raison_sociale: string } | null;
  entites_facturation: { raison_sociale: string; siret: string | null } | null;
  factures_collectes: { count: number }[] | null;
}

type BadgeVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'action'
  | 'neutral'
  | 'primary';

const STATUT_LABELS: Record<string, { label: string; variant: BadgeVariant }> =
  {
    brouillon: { label: 'Brouillon', variant: 'neutral' },
    en_attente_pennylane: { label: 'En attente', variant: 'warning' },
    emise: { label: 'Émise', variant: 'info' },
    payee: { label: 'Payée', variant: 'success' },
    annulee: { label: 'Annulée', variant: 'error' },
  };

const TYPE_LABELS: Record<string, string> = {
  zero_dechet: 'ZD',
  collecte_antigaspi: 'AG',
  achat_pack_antigaspi: 'Pack',
  avoir: 'Avoir',
};

// Filtre statut (§06.08 §4/§2.3). '__erreur__' = pseudo-filtre « En erreur »
// (factures portant une erreur de synchro Pennylane).
const FILTRES = [
  { key: '', label: 'Tout' },
  { key: 'brouillon', label: 'Brouillons' },
  { key: 'en_attente_pennylane', label: 'En attente Pennylane' },
  { key: '__erreur__', label: 'En erreur' },
  { key: 'emise', label: 'Émises' },
  { key: 'payee', label: 'Payées' },
  { key: 'annulee', label: 'Annulées' },
];

const TYPE_OPTIONS = [
  { key: '', label: 'Tous les types' },
  { key: 'zero_dechet', label: 'Zéro Déchet' },
  { key: 'collecte_antigaspi', label: 'Anti-Gaspi' },
  { key: 'achat_pack_antigaspi', label: 'Achat Pack AG' },
  { key: 'avoir', label: 'Avoir' },
];

async function downloadPdfSavr(id: string): Promise<void> {
  const res = await fetch(`/api/v1/admin/factures/${id}/pdf-savr/download`);
  if (!res.ok) return;
  const { url } = (await res.json()) as { url?: string };
  if (url) window.open(url, '_blank');
}

const columns: Column<Facture>[] = [
  {
    key: 'numero_facture',
    header: 'Numéro',
    render: (row) => (
      <Link
        href={`/admin/factures/${row.id}`}
        className="font-medium text-savr-primary-700 hover:underline"
      >
        {row.numero_facture ?? '— brouillon —'}
      </Link>
    ),
  },
  {
    key: 'organisations',
    header: 'Organisation',
    render: (row) => row.organisations?.raison_sociale ?? '—',
  },
  {
    key: 'type',
    header: 'Type',
    render: (row) => TYPE_LABELS[row.type] ?? row.type,
  },
  {
    key: 'lignes',
    header: 'Lignes',
    render: (row) => row.factures_collectes?.[0]?.count ?? 0,
  },
  {
    key: 'montant_ht',
    header: 'Montant HT',
    render: (row) =>
      new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: row.devise,
      }).format(row.montant_ht),
  },
  {
    key: 'montant_ttc',
    header: 'TTC',
    render: (row) =>
      new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: row.devise,
      }).format(row.montant_ttc),
  },
  {
    key: 'created_at',
    header: 'Créée le',
    render: (row) =>
      row.created_at
        ? new Date(row.created_at).toLocaleDateString('fr-FR')
        : '—',
  },
  {
    key: 'date_emission',
    header: 'Émission',
    render: (row) =>
      row.date_emission
        ? new Date(row.date_emission).toLocaleDateString('fr-FR')
        : '—',
  },
  {
    key: 'statut',
    header: 'Statut',
    render: (row) => {
      const s = STATUT_LABELS[row.statut] ?? {
        label: row.statut,
        variant: 'neutral' as BadgeVariant,
      };
      // §06.08 §10 — borne stricte au grain jour (échéance du jour ≠ en retard).
      const enRetard = estEnRetard(row.statut, row.date_echeance, Date.now());
      // Pastille orange §06.08 §2.3/§4 : en_attente_pennylane depuis > 2h.
      const pastille = pastillePennylane2h(
        row.statut,
        row.derniere_tentative_pennylane_at,
        Date.now(),
      );
      return (
        <span className="flex items-center gap-1.5">
          {pastille && (
            <span
              title="En attente Pennylane depuis plus de 2 h"
              aria-label="En attente Pennylane depuis plus de 2 h"
              data-testid="pastille-pennylane-2h"
              className="inline-block h-2.5 w-2.5 rounded-full bg-orange-500"
            />
          )}
          <Badge variant={s.variant}>{s.label}</Badge>
          {enRetard && <Badge variant="error">En retard</Badge>}
        </span>
      );
    },
  },
  {
    key: 'pdf_savr',
    header: 'PDF Savr',
    render: (row) =>
      row.pdf_url_savr ? (
        <button
          type="button"
          onClick={() => downloadPdfSavr(row.id)}
          className="inline-flex items-center gap-1 text-sm text-savr-primary-700 hover:underline"
        >
          <Download className="h-3.5 w-3.5" />
          PDF
        </button>
      ) : (
        <span className="text-neutral-400">—</span>
      ),
  },
];

export default function FacturesPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState('');
  const [typeFiltre, setTypeFiltre] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [orgFiltre, setOrgFiltre] = useState('');
  const [orgs, setOrgs] = useState<{ id: string; label: string }[]>([]);

  // Liste complète des organisations pour le filtre (§06.08 §4/§8). Boucle de
  // pagination (pas de troncature silencieuse) — même pattern que la liste collectes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const all: { id: string; label: string }[] = [];
      for (let p = 1; p <= 40; p++) {
        const res = await fetch(`/api/v1/admin/organisations?page=${p}`);
        if (!res.ok) break;
        const j = (await res.json()) as {
          data: { id: string; raison_sociale: string }[];
          limit?: number;
        };
        all.push(
          ...(j.data ?? []).map((o) => ({ id: o.id, label: o.raison_sociale })),
        );
        if ((j.data?.length ?? 0) < (j.limit ?? 50)) break;
      }
      if (!cancelled)
        setOrgs(all.sort((a, b) => a.label.localeCompare(b.label)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filtre === '__erreur__') params.set('en_erreur', '1');
    else if (filtre) params.set('statut', filtre);
    if (typeFiltre) params.set('type', typeFiltre);
    if (orgFiltre) params.set('organisation_id', orgFiltre);
    if (dateDebut) params.set('date_debut', dateDebut);
    if (dateFin) params.set('date_fin', dateFin);
    return params.toString();
  }, [filtre, typeFiltre, orgFiltre, dateDebut, dateFin]);

  const load = useCallback(() => {
    setLoading(true);
    const qs = buildParams();
    fetch(`/api/v1/admin/factures${qs ? `?${qs}` : ''}`)
      .then((r) => r.json())
      .then((d: { data: Facture[] }) => setFactures(d.data ?? []))
      .finally(() => setLoading(false));
  }, [buildParams]);

  useEffect(() => {
    load();
  }, [load]);

  function exportCsv() {
    const qs = buildParams();
    window.open(`/api/v1/exports/factures${qs ? `?${qs}` : ''}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-savr-primary-600" />
          <h1 className="text-2xl font-semibold">Factures</h1>
        </div>
        <Button variant="ghost" onClick={exportCsv}>
          Exporter CSV
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTRES.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltre(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filtre === f.key
                ? 'bg-savr-primary-600 text-white'
                : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex gap-3 flex-wrap items-end">
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Organisation
          <select
            value={orgFiltre}
            onChange={(e) => setOrgFiltre(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm min-w-[12rem]"
          >
            <option value="">Toutes les organisations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Type
          <select
            value={typeFiltre}
            onChange={(e) => setTypeFiltre(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Période — du
          <input
            type="date"
            value={dateDebut}
            onChange={(e) => setDateDebut(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          au
          <input
            type="date"
            value={dateFin}
            onChange={(e) => setDateFin(e.target.value)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />
        </label>
        {(dateDebut || dateFin || typeFiltre || orgFiltre) && (
          <Button
            variant="ghost"
            onClick={() => {
              setTypeFiltre('');
              setOrgFiltre('');
              setDateDebut('');
              setDateFin('');
            }}
          >
            Réinitialiser
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : factures.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="Aucune facture"
          description="Les brouillons apparaissent ici après le batch J+1."
        />
      ) : (
        <DataTable
          columns={columns}
          data={factures}
          keyExtractor={(row) => row.id}
        />
      )}
    </div>
  );
}
