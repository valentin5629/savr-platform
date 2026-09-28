'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';

interface DocItem {
  type: 'rapport' | 'bordereau' | 'attestation';
  id: string;
  collecte_id: string;
  evenement_nom: string | null;
  date: string | null;
  disponible: boolean;
  sous_embargo: boolean;
  disponible_a: string | null;
}

const LABELS: Record<DocItem['type'], string> = {
  rapport: 'Rapport RSE',
  bordereau: 'Bordereau ZD',
  attestation: 'Attestation de don',
};

/** Clé unique d'un document (les id ne sont uniques que par type). */
const cle = (d: DocItem) => `${d.type}-${d.id}`;

// §11 §7 — Accès lecture seule aux documents PDF (rapports RSE / bordereaux / attestations).
// Le téléchargement passe par une URL pré-signée R2 (embargo H+24 re-vérifié côté serveur).
export default function ClientOrganisateurDocumentsPage() {
  const [items, setItems] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/organisateur/documents')
      .then((r) => r.json())
      .then((j) => setItems((j.data ?? []) as DocItem[]))
      .finally(() => setLoading(false));
  }, []);

  async function download(d: DocItem) {
    setBusy(cle(d));
    try {
      const res = await fetch(
        `/api/v1/organisateur/documents/${encodeURIComponent(d.type)}/${encodeURIComponent(d.id)}/download`,
      );
      const json = (await res.json()) as { url?: string };
      if (res.ok && json.url) {
        window.open(json.url, '_blank', 'noopener');
      }
    } finally {
      setBusy(null);
    }
  }

  const colonnes: ColumnDef<DocItem, unknown>[] = [
    {
      id: 'document',
      header: 'Document',
      accessorFn: (d) => LABELS[d.type],
      cell: ({ row: { original: d } }) => LABELS[d.type],
    },
    {
      id: 'evenement',
      header: 'Événement',
      accessorFn: (d) => d.evenement_nom ?? '',
      cell: ({ row: { original: d } }) => d.evenement_nom ?? '—',
    },
    {
      id: 'date',
      header: 'Date',
      accessorFn: (d) => d.date ?? '',
      meta: { className: 'whitespace-nowrap' },
      cell: ({ row: { original: d } }) => d.date ?? '—',
    },
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (d) => (d.sous_embargo ? 1 : d.disponible ? 0 : 2),
      cell: ({ row: { original: d } }) =>
        d.sous_embargo ? (
          <Badge variant="warning">Disponible sous 24 h</Badge>
        ) : d.disponible ? (
          <Badge variant="success">Disponible</Badge>
        ) : (
          <Badge variant="neutral">En préparation</Badge>
        ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { label: 'Actions', interactive: true, className: 'text-right' },
      cell: ({ row: { original: d } }) => (
        <Button
          variant="ghost"
          disabled={!d.disponible || busy === cle(d)}
          onClick={() => download(d)}
        >
          Télécharger
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Mes documents
      </h1>

      {/* Data Table commune. Tri côté navigateur : la route renvoie la liste
          complète des documents (aucune pagination ni `.limit()`). Ordre
          initial = celui de la route (rapports, bordereaux, attestations). */}
      <DataGrid
        columns={colonnes}
        data={items}
        getRowId={cle}
        loading={loading}
        empty={
          <p className="text-sm text-savr-neutral-500">
            Aucun document disponible pour le moment.
          </p>
        }
      />
    </div>
  );
}
