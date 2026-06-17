'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
    setBusy(`${d.type}-${d.id}`);
    try {
      const res = await fetch(
        `/api/v1/organisateur/documents/${d.type}/${d.id}/download`,
      );
      const json = (await res.json()) as { url?: string };
      if (res.ok && json.url) {
        window.open(json.url, '_blank', 'noopener');
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Mes documents
      </h1>

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">
          Aucun document disponible pour le moment.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Événement</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr
                  key={`${d.type}-${d.id}`}
                  className="border-t border-savr-neutral-100"
                >
                  <td className="px-3 py-2">{LABELS[d.type]}</td>
                  <td className="px-3 py-2">{d.evenement_nom ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {d.date ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {d.sous_embargo ? (
                      <Badge variant="warning">Disponible sous 24 h</Badge>
                    ) : d.disponible ? (
                      <Badge variant="success">Disponible</Badge>
                    ) : (
                      <Badge variant="neutral">En préparation</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      disabled={!d.disponible || busy === `${d.type}-${d.id}`}
                      onClick={() => download(d)}
                    >
                      Télécharger
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
