'use client';

import { useEffect, useState, useCallback } from 'react';
import { Truck, Plus } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  StatusCollecte,
  type StatutCollecte,
} from '@/components/ui/status-collecte';

interface Collecte {
  id: string;
  type: 'zero_dechet' | 'anti_gaspi';
  statut: string;
  statut_tms: string;
  dirty_tms: boolean;
  date_collecte: string;
  heure_collecte: string;
  // Présence d'attribution AG (to-one via contrainte unique) : null = à attribuer.
  attributions_antgaspi: { id: string } | null;
  evenements: {
    nom_evenement: string | null;
    pax: number | null;
    organisations: { raison_sociale: string };
    lieux: { nom: string; ville: string };
  };
}

const CHIPS = [
  { key: 'non_transmises', label: 'Non transmises TMS' },
  { key: 'attente_prestataire', label: 'Attente prestataire' },
  { key: 'dirty_tms', label: 'Modifiées sans renvoi' },
  { key: 'ag_attente_attribution', label: 'Collectes à attribuer' },
  { key: 'zd_48h', label: 'ZD 48h' },
  { key: 'ag_48h', label: 'AG 48h' },
];

// Collecte AG « à attribuer » : programmée et sans attribution encore (≈ « Créée »).
// Une fois attribuée, elle a une ligne attributions_antgaspi → statut « Programmée ».
function aAttribuer(row: Collecte): boolean {
  return (
    row.type === 'anti_gaspi' &&
    row.statut === 'programmee' &&
    row.attributions_antgaspi == null
  );
}

// Criticité (§06.09 §1 / ALGO-02) : collecte à attribuer ET à moins de 48h.
function estUrgente(row: Collecte): boolean {
  if (!aAttribuer(row)) return false;
  const ts = new Date(
    `${row.date_collecte}T${row.heure_collecte ?? '00:00:00'}`,
  ).getTime();
  return Number.isFinite(ts) && ts < Date.now() + 48 * 60 * 60 * 1000;
}

const columns: Column<Collecte>[] = [
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
    key: 'date_collecte',
    header: 'Date',
    render: (row) => (
      <span className="flex items-center gap-2">
        {estUrgente(row) && (
          <Badge variant="error" dot={false}>
            URGENT
          </Badge>
        )}
        <Link
          href={`/admin/collectes/${row.id}`}
          className="font-medium text-primary-700 hover:underline"
        >
          {new Date(row.date_collecte).toLocaleDateString('fr-FR')}
        </Link>
      </span>
    ),
  },
  {
    key: 'heure_collecte',
    header: 'Heure',
    render: (row) => row.heure_collecte?.slice(0, 5) ?? '—',
  },
  {
    key: 'traiteur',
    header: 'Traiteur',
    render: (row) => row.evenements.organisations.raison_sociale,
  },
  {
    key: 'pax',
    header: 'Pax',
    render: (row) => row.evenements.pax ?? '—',
  },
  {
    key: 'lieu',
    header: 'Lieu',
    render: (row) =>
      `${row.evenements.lieux.nom} — ${row.evenements.lieux.ville}`,
  },
  {
    key: 'statut',
    header: 'Statut',
    render: (row) =>
      aAttribuer(row) ? (
        <Badge variant="neutral">Créée</Badge>
      ) : (
        <StatusCollecte statut={row.statut as StatutCollecte} />
      ),
  },
  {
    // §06.09 — accès direct à l'écran d'attribution AG depuis la liste collectes.
    // Affiché uniquement pour les collectes AG « à attribuer » (= « Créée » :
    // programmée + sans attribution). Une fois attribuée, plus de bouton.
    key: 'attribution',
    header: '',
    render: (row) =>
      aAttribuer(row) ? (
        <Link
          href={`/admin/attributions-ag/${row.id}`}
          className="text-sm font-medium text-primary-600 hover:underline"
        >
          Attribuer →
        </Link>
      ) : null,
  },
];

export default function CollectesPage() {
  const [collectes, setCollectes] = useState<Collecte[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chip, setChip] = useState('');
  const [type, setType] = useState('');
  const [statut, setStatut] = useState('');
  const [page, setPage] = useState(1);

  const fetchCollectes = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (chip) params.set('chip', chip);
    if (!chip && type) params.set('type', type);
    if (!chip && statut) params.set('statut', statut);
    const res = await fetch(`/api/v1/admin/collectes?${params}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data: Collecte[];
        total: number;
      };
      setCollectes(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [page, chip, type, statut]);

  useEffect(() => {
    void fetchCollectes();
  }, [fetchCollectes]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Collectes
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/collectes/nouvelle">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle collecte
            </Button>
          </Link>
        </div>
      </div>

      {/* Chips filtres prédéfinis */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setChip('');
            setPage(1);
          }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            chip === ''
              ? 'bg-primary-600 text-white'
              : 'bg-savr-neutral-100 text-savr-neutral-700 hover:bg-savr-neutral-200'
          }`}
        >
          Toutes
        </button>
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setChip(c.key);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              chip === c.key
                ? 'bg-primary-600 text-white'
                : 'bg-savr-neutral-100 text-savr-neutral-700 hover:bg-savr-neutral-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Filtres libres */}
      {!chip && (
        <div className="flex gap-3">
          <select
            className="border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous types</option>
            <option value="zero_dechet">ZD</option>
            <option value="anti_gaspi">AG</option>
          </select>
          <select
            className="border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
            value={statut}
            onChange={(e) => {
              setStatut(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous statuts</option>
            <option value="brouillon">Brouillon</option>
            <option value="programmee">Programmée</option>
            <option value="validee">Validée</option>
            <option value="en_cours">En cours</option>
            <option value="realisee">Réalisée</option>
            <option value="cloturee">Clôturée</option>
            <option value="annulee">Annulée</option>
          </select>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : collectes.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="Aucune collecte"
          description="Aucune collecte ne correspond à votre filtre."
        />
      ) : (
        <DataTable
          columns={columns}
          // Urgents (AG à attribuer < 48h) remontés en tête (§06.09 §1)
          data={[...collectes].sort(
            (a, b) => Number(estUrgente(b)) - Number(estUrgente(a)),
          )}
          keyExtractor={(row) => row.id}
          rowClassName={(r) => (estUrgente(r) ? 'bg-red-50' : '')}
          pagination={{ page, total, limit: 50, onPageChange: setPage }}
        />
      )}
    </div>
  );
}
