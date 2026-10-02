'use client';

import { useEffect, useState, useMemo } from 'react';
import { FileText, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { ListFooter } from '@/components/ui/list-footer';
import {
  useFiltresUrl,
  texte,
  liste,
  entier,
  navigation,
} from '@/lib/hooks/use-filtres-url';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHero } from '@/components/ui/page-hero';
import { FilterChips } from '@/components/ui/filter-chips';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches } from '@/components/ui/filtre-en-ligne';
import { pastillePennylane2h, estEnRetard } from '@/lib/facturation/facture-ui';
import type { Database } from '@savr/shared/src/database.types.js';
import { fmtMontant } from '@/lib/format';
import { TextLink } from '@/components/ui/text-link';

type Enums = Database['plateforme']['Enums'];

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
const PASTILLES_STATUT = [
  { key: '', label: 'Tout' },
  { key: 'brouillon', label: 'Brouillons' },
  { key: 'en_attente_pennylane', label: 'En attente Pennylane' },
  { key: '__erreur__', label: 'En erreur' },
  { key: 'emise', label: 'Émises' },
  { key: 'payee', label: 'Payées' },
  { key: 'annulee', label: 'Annulées' },
];

// Ids typés par l'enum DB : un renommage d'enum casse la compilation au lieu
// de devenir un filtre ignoré en silence par la route (liste blanche).
const TYPE_OPTIONS = [
  { id: 'zero_dechet', nom: 'Zéro Déchet' },
  { id: 'collecte_antigaspi', nom: 'Anti-Gaspi' },
  { id: 'achat_pack_antigaspi', nom: 'Achat Pack AG' },
  { id: 'avoir', nom: 'Avoir' },
] satisfies { id: Enums['facture_type']; nom: string }[];

async function downloadPdfSavr(id: string): Promise<void> {
  const res = await fetch(
    `/api/v1/admin/factures/${encodeURIComponent(id)}/pdf-savr/download`,
  );
  if (!res.ok) return;
  const { url } = (await res.json()) as { url?: string };
  if (url) window.open(url, '_blank');
}

const columns: Column<Facture>[] = [
  {
    key: 'numero_facture',
    sortable: true,
    header: 'Numéro',
    render: (row) => (
      <TextLink href={`/admin/factures/${row.id}`} className="font-medium">
        {row.numero_facture ?? '— brouillon —'}
      </TextLink>
    ),
  },
  {
    key: 'organisations',
    header: 'Organisation',
    render: (row) => row.organisations?.raison_sociale ?? '—',
  },
  {
    key: 'type',
    sortable: true,
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
    sortable: true,
    header: 'Montant HT',
    render: (row) => fmtMontant(row.montant_ht, row.devise),
  },
  {
    key: 'montant_ttc',
    sortable: true,
    header: 'TTC',
    render: (row) => fmtMontant(row.montant_ttc, row.devise),
  },
  {
    key: 'created_at',
    sortable: true,
    header: 'Créée le',
    render: (row) =>
      row.created_at
        ? new Date(row.created_at).toLocaleDateString('fr-FR', {
            timeZone: 'Europe/Paris',
          })
        : '—',
  },
  {
    key: 'date_emission',
    sortable: true,
    header: 'Émission',
    render: (row) =>
      row.date_emission
        ? new Date(row.date_emission).toLocaleDateString('fr-FR', {
            timeZone: 'Europe/Paris',
          })
        : '—',
  },
  {
    key: 'statut',
    sortable: true,
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
              className="inline-block h-2.5 w-2.5 rounded-savr-full bg-savr-warning"
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
        <TextLink onClick={() => downloadPdfSavr(row.id)} className="text-sm">
          <Download className="h-3.5 w-3.5" />
          PDF
        </TextLink>
      ) : (
        <span className="text-savr-neutral-400">—</span>
      ),
  },
];

// Filtres de la liste, miroir dans l'URL (R-UI-4a) : `statut` = pastille
// (« __erreur__ » = en erreur Pennylane) ; Organisation et Type à choix
// multiple, case « Tous » = sélection vide (décision Val 2026-09-30,
// divergence M0.8_20260930_filtres-choix-multiple-tous). Tri serveur (cf.
// lib/tri-liste), retour page 1 à chaque changement (BL-P3-07).
const FILTRES = {
  statut: texte(''),
  types: liste(),
  organisation_ids: liste(),
  date_debut: texte(''),
  date_fin: texte(''),
  page: navigation(entier(1)),
  tri: navigation(texte('created_at')),
  ordre: navigation(texte('desc')),
};

export default function FacturesPage() {
  const { valeurs: f, set, reset } = useFiltresUrl(FILTRES);
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

  // Paramètres API hors page (partagés avec l'export CSV).
  const qs = useMemo(() => {
    const params = new URLSearchParams();
    params.set('tri', f.tri);
    params.set('ordre', f.ordre);
    if (f.statut === '__erreur__') params.set('en_erreur', '1');
    else if (f.statut) params.set('statut', f.statut);
    if (f.types.length > 0) params.set('types', f.types.join(','));
    if (f.organisation_ids.length > 0)
      params.set('organisation_ids', f.organisation_ids.join(','));
    if (f.date_debut) params.set('date_debut', f.date_debut);
    if (f.date_fin) params.set('date_fin', f.date_fin);
    return params.toString();
  }, [f]);
  const {
    data: factures,
    total,
    loading,
    erreur,
    recharger,
  } = useListePaginee<Facture>(
    `/api/v1/admin/factures?${qs ? `${qs}&` : ''}page=${f.page}`,
  );
  const filtresActifs = Boolean(
    f.date_debut ||
    f.date_fin ||
    f.types.length > 0 ||
    f.organisation_ids.length > 0,
  );

  function exportCsv() {
    window.open(`/api/v1/exports/factures${qs ? `?${qs}` : ''}`);
  }

  return (
    <div className="space-y-5">
      <PageHero
        icon={<FileText className="h-6 w-6 text-savr-primary-200" />}
        title="Factures"
        subtitle={
          total > 0
            ? `${total} facture${total > 1 ? 's' : ''}`
            : 'Brouillons, émissions et avoirs'
        }
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download />
            Exporter CSV
          </Button>
        }
      />

      <FilterChips
        chips={PASTILLES_STATUT}
        activeKey={f.statut}
        ariaLabel="Filtrer par statut"
        onSelect={(statut) => set({ statut })}
      />

      <FilterBar
        data-testid="factures-filtres"
        count={`${total} facture${total > 1 ? 's' : ''}`}
        actif={filtresActifs}
        onReset={() => {
          // La pastille de statut n'est pas un filtre de la barre : conservée.
          reset();
          set({ statut: f.statut });
        }}
      >
        {/* « Période » en premier (décision Val 2026-09-30), puis filtres à
            choix multiple avec case « Tous ». */}
        <DateRangePicker
          titre="Période"
          id="filtre-periode"
          data-testid="filtre-periode"
          value={{ from: f.date_debut, to: f.date_fin }}
          onChange={(p) => set({ date_debut: p.from, date_fin: p.to })}
        />
        <FiltreCoches
          label="Organisation"
          testid="filtre-organisation"
          libelleVide="Toutes"
          libelleTous="Toutes"
          options={orgs.map((o) => ({ id: o.id, nom: o.label }))}
          selected={f.organisation_ids}
          onChange={(ids) => set({ organisation_ids: ids })}
        />
        <FiltreCoches
          label="Type"
          testid="filtre-type"
          options={TYPE_OPTIONS}
          selected={f.types}
          onChange={(ids) => set({ types: ids })}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={factures}
        keyExtractor={(row) => row.id}
        loading={loading}
        erreur={erreur}
        onRecharger={recharger}
        empty={
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="Aucune facture"
            description="Les brouillons apparaissent ici après le batch J+1."
          />
        }
        onSort={(cle, ordre) => set({ tri: cle, ordre })}
        sortKey={f.tri}
        sortDirection={f.ordre as 'asc' | 'desc'}
      />
      <ListFooter
        total={total}
        page={f.page}
        onPageChange={(page) => set({ page })}
      />
    </div>
  );
}
