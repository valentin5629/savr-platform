'use client';

import { Pencil, XCircle, Copy } from 'lucide-react';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';

// Carte simplifiée de la liste des collectes traiteur (BL-P2-14 + refonte liste
// 2026-07-05, décision Val). Reprend le langage visuel des cartes Admin (rail
// coloré par type, carte arrondie) mais n'affiche QUE : Date · Heure · Lieu · Pax
// · Statut, plus les actions Modifier / Annuler / Dupliquer.
// Le rendu du type (ZD/AG) est porté par le rail coloré ; le contenu métier
// détaillé reste sur la fiche (clic sur la carte).

export interface TraiteurCollecteCardData {
  id: string;
  type: string; // 'zero_dechet' | 'anti_gaspi'
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  pax: number | null;
  programmee_par_tiers: boolean;
}

// Gates d'action alignés sur la fiche (§05 §4) :
//  - Modifier : statut programmee / validee
//  - Annuler  : statut brouillon / programmee / validee (validee = demande Admin)
// Dupliquer est toujours disponible (crée une NOUVELLE collecte à partir du
// modèle, y compris depuis une collecte passée à reprogrammer).
const STATUTS_EDITABLES = ['programmee', 'validee'];
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];

export function TraiteurCollecteCard({
  c,
  canWrite,
  onOpen,
  onModifier,
  onAnnuler,
  onDupliquer,
}: {
  c: TraiteurCollecteCardData;
  canWrite: boolean;
  onOpen: () => void;
  onModifier: () => void;
  onAnnuler: () => void;
  onDupliquer: () => void;
}): React.JSX.Element {
  const zd = c.type === 'zero_dechet';
  const editable = canWrite && STATUTS_EDITABLES.includes(c.statut);
  const annulable = canWrite && STATUTS_ANNULABLES.includes(c.statut);
  const jour = (() => {
    const d = new Date(`${c.date_collecte}T00:00:00`);
    return isNaN(d.getTime())
      ? c.date_collecte
      : d.toLocaleDateString('fr-FR', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
        });
  })();
  const heure = c.heure_collecte?.slice(0, 5) ?? '—';
  const lieuLigne = [c.lieu_nom, c.lieu_adresse].filter(Boolean).join(' · ');

  return (
    <div className="relative flex flex-wrap items-center gap-x-6 gap-y-3 overflow-hidden rounded-savr-lg border border-savr-neutral-200 bg-savr-white py-3 pr-4 pl-5">
      <span
        className={`absolute inset-y-0 left-0 w-1 rounded-l-savr-lg ${zd ? 'bg-savr-success' : 'bg-savr-warning'}`}
      />

      {/* Zone cliquable → fiche : Date · Heure · Lieu · Pax */}
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left focus-visible:outline-2"
      >
        <div className="flex items-center gap-2 font-semibold text-savr-neutral-900">
          <span className="capitalize">{jour}</span>
          <span className="text-savr-neutral-300">·</span>
          <span>{heure}</span>
          {c.programmee_par_tiers && (
            <span
              title="Programmée par un tiers"
              aria-label="Programmée par un tiers"
            >
              🏷️
            </span>
          )}
        </div>
        <div className="mt-0.5 text-sm text-savr-neutral-600">
          {lieuLigne || '—'}
          <span className="text-savr-neutral-300"> · </span>
          {c.pax != null ? `${c.pax} pax` : '— pax'}
        </div>
      </button>

      {/* Statut */}
      <CollecteStatutBadge statut={c.statut} />

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!editable}
          onClick={onModifier}
          title={editable ? 'Modifier' : 'Modification impossible à ce statut'}
          className="inline-flex items-center gap-1 rounded-savr-md px-2.5 py-1.5 text-sm text-savr-neutral-700 hover:bg-savr-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil className="h-4 w-4" /> Modifier
        </button>
        <button
          type="button"
          disabled={!annulable}
          onClick={onAnnuler}
          title={annulable ? 'Annuler' : 'Annulation impossible à ce statut'}
          className="inline-flex items-center gap-1 rounded-savr-md px-2.5 py-1.5 text-sm text-savr-error-600 hover:bg-savr-error-subtle disabled:cursor-not-allowed disabled:opacity-40"
        >
          <XCircle className="h-4 w-4" /> Annuler
        </button>
        <button
          type="button"
          onClick={onDupliquer}
          title="Dupliquer"
          className="inline-flex items-center gap-1 rounded-savr-md px-2.5 py-1.5 text-sm text-savr-neutral-700 hover:bg-savr-neutral-100"
        >
          <Copy className="h-4 w-4" /> Dupliquer
        </button>
      </div>
    </div>
  );
}
