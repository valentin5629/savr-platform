'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { FileText, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
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
const FILTRES = [
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

export default function FacturesPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtre, setFiltre] = useState('');
  // Organisation et Type à choix multiple, case « Tous » = sélection vide
  // (décision Val 2026-09-30, divergence M0.8_20260930_filtres-choix-multiple-tous).
  const [types, setTypes] = useState<string[]>([]);
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [orgs, setOrgs] = useState<{ id: string; label: string }[]>([]);
  const [page, setPage] = useState(1);
  // Tri serveur de la Data Table (liste paginée) : envoyé à l'API, retour
  // en page 1 à chaque changement (cf. lib/tri-liste).
  const [tri, setTri] = useState<{ cle: string; ordre: 'asc' | 'desc' }>({
    cle: 'created_at',
    ordre: 'desc',
  });
  const [total, setTotal] = useState(0);

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
    params.set('tri', tri.cle);
    params.set('ordre', tri.ordre);
    if (filtre === '__erreur__') params.set('en_erreur', '1');
    else if (filtre) params.set('statut', filtre);
    if (types.length > 0) params.set('types', types.join(','));
    if (orgIds.length > 0) params.set('organisation_ids', orgIds.join(','));
    if (dateDebut) params.set('date_debut', dateDebut);
    if (dateFin) params.set('date_fin', dateFin);
    return params.toString();
  }, [filtre, types, orgIds, dateDebut, dateFin, tri]);

  // Numéro de la dernière requête : une réponse plus ancienne arrivée après
  // (cases cochées en rafale) est ignorée au lieu d'écraser la liste.
  const derniereRequete = useRef(0);

  const load = useCallback(() => {
    const numero = ++derniereRequete.current;
    const perime = () => numero !== derniereRequete.current;
    setLoading(true);
    const qs = buildParams();
    const url = `/api/v1/admin/factures?${qs ? `${qs}&` : ''}page=${page}`;
    fetch(url)
      .then((r) => r.json())
      .then((d: { data: Facture[]; total?: number }) => {
        if (perime()) return;
        setFactures(d.data ?? []);
        setTotal(d.total ?? 0);
      })
      .finally(() => {
        if (!perime()) setLoading(false);
      });
  }, [buildParams, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Retour à la page 1 quand les filtres changent (BL-P3-07).
  useEffect(() => {
    setPage(1);
  }, [buildParams]);

  function exportCsv() {
    const qs = buildParams();
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
        chips={FILTRES}
        activeKey={filtre}
        ariaLabel="Filtrer par statut"
        onSelect={setFiltre}
      />

      <FilterBar
        data-testid="factures-filtres"
        actif={Boolean(
          dateDebut || dateFin || types.length > 0 || orgIds.length > 0,
        )}
        onReset={() => {
          setTypes([]);
          setOrgIds([]);
          setDateDebut('');
          setDateFin('');
        }}
      >
        {/* « Période » en premier (décision Val 2026-09-30), puis filtres à
            choix multiple avec case « Tous ». */}
        <DateRangePicker
          titre="Période"
          id="filtre-periode"
          data-testid="filtre-periode"
          value={{ from: dateDebut, to: dateFin }}
          onChange={(p) => {
            setDateDebut(p.from);
            setDateFin(p.to);
          }}
        />
        <FiltreCoches
          label="Organisation"
          testid="filtre-organisation"
          libelleVide="Toutes"
          libelleTous="Toutes"
          options={orgs.map((o) => ({ id: o.id, nom: o.label }))}
          selected={orgIds}
          onChange={setOrgIds}
        />
        <FiltreCoches
          label="Type"
          testid="filtre-type"
          options={TYPE_OPTIONS}
          selected={types}
          onChange={setTypes}
        />
      </FilterBar>

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
        <>
          <DataTable
            columns={columns}
            data={factures}
            keyExtractor={(row) => row.id}
            onSort={(cle, ordre) => {
              setTri({ cle, ordre });
              setPage(1);
            }}
            sortKey={tri.cle}
            sortDirection={tri.ordre}
          />
          {total > 50 && (
            <div className="flex items-center justify-between gap-2 pt-3 text-sm">
              <span className="text-savr-neutral-500">
                {total} facture{total > 1 ? 's' : ''}
              </span>
              <Pagination
                page={page}
                pageCount={Math.ceil(total / 50)}
                onPageChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
