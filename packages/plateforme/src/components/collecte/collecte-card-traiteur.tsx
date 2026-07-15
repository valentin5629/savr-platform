'use client';

import {
  Pencil,
  XCircle,
  Copy,
  Download,
  Scale,
  Recycle,
  Leaf,
  Package,
} from 'lucide-react';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { IconButton } from '@/components/ui/icon-button';

// Carte de la liste des collectes traiteur (BL-P2-14 + refonte liste 2026-07-05,
// enrichie revue écran 2026-07-15, décisions Val). Reprend le langage visuel des
// cartes Admin (rail coloré par type, carte arrondie) : Date · Heure · Lieu · Pax
// · Statut + actions icône-seule Modifier / Annuler / Dupliquer (masquées si
// indisponibles). Sur une collecte réalisée (cloturee), affiche à gauche du badge
// « Réalisée » les résultats (ZD : poids / taux / CO₂ ; AG : repas / CO₂) et le
// téléchargement du rapport. Le rendu du type (ZD/AG) est porté par le rail coloré ;
// le contenu métier détaillé reste sur la fiche (clic sur la carte).

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
  // Résultats affichés sur la collecte réalisée (statut cloturee).
  // ZD : poids total (Σ flux) + taux de recyclage. AG : repas donnés. Les deux : CO₂ évité.
  poids_total_kg: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  nb_repas_donnes: number | null;
}

// Gates d'action alignés sur la fiche (§05 §4). Action indisponible = picto MASQUÉ
// (décision Val 2026-07-15 — plus de bouton grisé sur la carte liste) :
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
  onTelecharger,
}: {
  c: TraiteurCollecteCardData;
  canWrite: boolean;
  onOpen: () => void;
  onModifier: () => void;
  onAnnuler: () => void;
  onDupliquer: () => void;
  onTelecharger: () => void;
}): React.JSX.Element {
  const zd = c.type === 'zero_dechet';
  const editable = canWrite && STATUTS_EDITABLES.includes(c.statut);
  const annulable = canWrite && STATUTS_ANNULABLES.includes(c.statut);
  // « Réalisée » (vue client) = statut cloturee : on affiche les résultats de la
  // collecte + le téléchargement du rapport, à gauche du badge.
  const estRealisee = c.statut === 'cloturee';
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

      {/* Résultats + téléchargement du rapport (collecte réalisée = cloturee),
          affichés à GAUCHE du badge « Réalisée ». */}
      {estRealisee && (
        <>
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs font-bold text-savr-neutral-600">
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
          </div>
          <IconButton
            variant="ghost"
            onClick={onTelecharger}
            title="Télécharger le rapport"
            aria-label="Télécharger le rapport de la collecte"
          >
            <Download />
          </IconButton>
        </>
      )}

      {/* Statut */}
      <CollecteStatutBadge statut={c.statut} />

      {/* Actions — IconButton (§10 §6, icône seule) : libellé au survol (title),
          cible tactile 44/40px, focus-ring signature. L'action indisponible n'est
          pas rendue (plus de bouton grisé). */}
      <div className="flex items-center gap-1">
        {editable && (
          <IconButton
            variant="ghost"
            onClick={onModifier}
            title="Modifier"
            aria-label="Modifier la collecte"
          >
            <Pencil />
          </IconButton>
        )}
        {annulable && (
          <IconButton
            variant="destructive"
            onClick={onAnnuler}
            title="Annuler"
            aria-label="Annuler la collecte"
          >
            <XCircle />
          </IconButton>
        )}
        <IconButton
          variant="ghost"
          onClick={onDupliquer}
          title="Dupliquer"
          aria-label="Dupliquer la collecte"
        >
          <Copy />
        </IconButton>
      </div>
    </div>
  );
}
