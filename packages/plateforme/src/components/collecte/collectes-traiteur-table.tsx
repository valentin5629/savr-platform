'use client';

import type { ColumnDef } from '@tanstack/react-table';
import {
  Copy,
  Download,
  Leaf,
  Package,
  Pencil,
  Recycle,
  Scale,
  Tag,
  XCircle,
} from 'lucide-react';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { IconButton } from '@/components/ui/icon-button';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { CelluleVide } from '@/components/ui/data-grid';

// Ligne de la Data Table Collectes traiteur (BL-P2-14, refonte liste 2026-07-05,
// revue écran 2026-07-15, passage en Data Table 2026-09-28 — décisions Val).
// Colonnes : Date · Lieu · Pax · Résultats (collecte réalisée) · Statut ·
// Actions icône-seule Modifier / Annuler / Dupliquer (masquées si
// indisponibles). Le contenu métier détaillé reste sur la fiche (clic ligne).
export interface TraiteurCollecteLigne {
  id: string;
  type: string; // 'zero_dechet' | 'anti_gaspi'
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  pax: number | null;
  programmee_par_tiers: boolean;
  /** Droit d'écriture de l'appelant sur cette collecte (manager, ou commercial
   *  créateur de l'événement). */
  canWrite: boolean;
  // Résultats affichés sur la collecte réalisée (statut cloturee).
  // ZD : poids total (Σ flux) + taux de recyclage. AG : repas donnés. Les deux : CO₂ évité.
  poids_total_kg: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  nb_repas_donnes: number | null;
}

// Gates d'action alignés sur la fiche (§05 §4). Action indisponible = picto MASQUÉ
// (décision Val 2026-07-15 — plus de bouton grisé dans la liste) :
//  - Modifier : statut programmee / validee
//  - Annuler  : statut brouillon / programmee / validee (validee = demande Admin)
// Dupliquer est toujours disponible (crée une NOUVELLE collecte à partir du
// modèle, y compris depuis une collecte passée à reprogrammer).
const STATUTS_EDITABLES = ['programmee', 'validee'];
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];

export interface ActionsTraiteur {
  onModifier: (c: TraiteurCollecteLigne) => void;
  onAnnuler: (c: TraiteurCollecteLigne) => void;
  onDupliquer: (c: TraiteurCollecteLigne) => void;
  onTelecharger: (c: TraiteurCollecteLigne) => void;
}

// « Réalisée » (vue client) = statut cloturee : résultats + rapport.
function Resultats({
  c,
  onTelecharger,
}: {
  c: TraiteurCollecteLigne;
  onTelecharger: () => void;
}) {
  if (c.statut !== 'cloturee') return <CelluleVide />;
  const zd = c.type === 'zero_dechet';
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs font-bold text-savr-neutral-600 sm:justify-start">
      {zd ? (
        <>
          {c.poids_total_kg != null && c.poids_total_kg > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-savr-neutral-400" />
              {c.poids_total_kg.toLocaleString('fr-FR', {
                maximumFractionDigits: 1,
              })}{' '}
              kg
            </span>
          )}
          {c.taux_recyclage != null && (
            <span className="inline-flex items-center gap-1.5">
              <Recycle className="h-3.5 w-3.5 text-savr-neutral-400" />
              {c.taux_recyclage.toLocaleString('fr-FR', {
                maximumFractionDigits: 0,
              })}{' '}
              %
            </span>
          )}
        </>
      ) : (
        c.nb_repas_donnes != null &&
        c.nb_repas_donnes > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-savr-neutral-400" />
            {c.nb_repas_donnes} repas
          </span>
        )
      )}
      {c.co2_evite_kg != null && c.co2_evite_kg > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Leaf className="h-3.5 w-3.5 text-savr-neutral-400" />
          {c.co2_evite_kg.toLocaleString('fr-FR', {
            maximumFractionDigits: 0,
          })}{' '}
          kg CO₂e
        </span>
      )}
      <IconButton
        variant="ghost"
        onClick={onTelecharger}
        title="Télécharger le rapport"
        aria-label="Télécharger le rapport de la collecte"
      >
        <Download />
      </IconButton>
    </div>
  );
}

// Colonnes de la Data Table (tri côté client : la route n'est pas paginée).
export function colonnesCollectesTraiteur(
  actions: ActionsTraiteur,
): ColumnDef<TraiteurCollecteLigne, unknown>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      enableHiding: false,
      accessorFn: (c) => `${c.date_collecte} ${c.heure_collecte ?? ''}`,
      cell: ({ row: { original: c } }) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap font-semibold text-savr-neutral-900 tabular-nums">
          {libelleDateHeure(c.date_collecte, c.heure_collecte)}
          {c.programmee_par_tiers && (
            <span title="Programmée par un tiers">
              {/* Picto orange « user-tag » (§06.04 Vue liste). */}
              <Tag
                className="h-3.5 w-3.5 text-savr-warning"
                aria-label="Programmée par un tiers"
              />
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'lieu',
      header: 'Lieu',
      accessorFn: (c) => c.lieu_nom ?? '',
      cell: ({ row: { original: c } }) =>
        c.lieu_nom || c.lieu_adresse ? (
          <div className="min-w-0">
            <div className="font-medium">{c.lieu_nom ?? '—'}</div>
            {c.lieu_adresse && (
              <div className="text-xs text-savr-neutral-500">
                {c.lieu_adresse}
              </div>
            )}
          </div>
        ) : (
          <CelluleVide />
        ),
    },
    {
      id: 'pax',
      header: 'Pax',
      accessorFn: (c) => c.pax ?? -1,
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: c } }) =>
        c.pax != null ? `${c.pax} pax` : <CelluleVide />,
    },
    {
      id: 'resultats',
      header: 'Résultats',
      meta: { interactive: true },
      cell: ({ row: { original: c } }) => (
        <Resultats c={c} onTelecharger={() => actions.onTelecharger(c)} />
      ),
    },
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (c) => c.statut,
      cell: ({ row: { original: c } }) => (
        <CollecteStatutBadge statut={c.statut} />
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: {
        label: 'Actions',
        interactive: true,
        stickyRight: true,
        className: 'text-right',
      },
      cell: ({ row: { original: c } }) => (
        // IconButton (§10 §6, icône seule) : libellé au survol (title), cible
        // tactile 44/40px. L'action indisponible n'est pas rendue.
        <div className="flex items-center justify-end gap-1">
          {c.canWrite && STATUTS_EDITABLES.includes(c.statut) && (
            <IconButton
              variant="ghost"
              onClick={() => actions.onModifier(c)}
              title="Modifier"
              aria-label="Modifier la collecte"
            >
              <Pencil />
            </IconButton>
          )}
          {c.canWrite && STATUTS_ANNULABLES.includes(c.statut) && (
            <IconButton
              variant="destructive"
              onClick={() => actions.onAnnuler(c)}
              title="Annuler"
              aria-label="Annuler la collecte"
            >
              <XCircle />
            </IconButton>
          )}
          <IconButton
            variant="ghost"
            onClick={() => actions.onDupliquer(c)}
            title="Dupliquer"
            aria-label="Dupliquer la collecte"
          >
            <Copy />
          </IconButton>
        </div>
      ),
    },
  ];
}
