import { Badge } from '@/components/ui/badge';
import { FriseEtapes } from '@/components/collecte/frise-statut-client';
import {
  statutCollecteDisplay,
  type EtapeFriseClient,
} from '@/lib/statut-collecte-labels';

// Parcours nominal d'une collecte (machine à états §05, CLAUDE.md §3) :
// programmee → validee → en_cours → realisee → cloturee.
const ETAPES = [
  { statut: 'programmee', label: 'Programmée' },
  { statut: 'validee', label: 'Validée' },
  { statut: 'en_cours', label: 'En cours' },
  { statut: 'realisee', label: 'Réalisée' },
  { statut: 'cloturee', label: 'Clôturée' },
] as const;

// Statuts qui sortent du parcours : la frise reste affichée (repère) mais aucune
// étape n'est marquée, et le statut réel est porté par un badge d'erreur.
const HORS_PARCOURS = [
  'annulation_demandee',
  'annulee',
  'rejetee_par_prestataire',
];

function indexEtape(statut: string): number {
  // AG « réalisée sans collecte » : même rang que « Réalisée » (étape terminale
  // de la réalisation), libellé propre ci-dessous.
  if (statut === 'realisee_sans_collecte') return 3;
  return ETAPES.findIndex((e) => e.statut === statut);
}

// Frise d'avancement de la fiche collecte Admin (décision Val C2 2026-09-29) :
// granularité complète, au rendu compact de la frise client en haut à droite du
// grand en-tête (décision Val 2026-10-01).
export function CollecteStatutFrise({ statut }: { statut: string }) {
  const courant = HORS_PARCOURS.includes(statut) ? -1 : indexEtape(statut);
  // Statut hors frise (annulé, rejeté, brouillon « Créée ») : aucune étape
  // marquée (frise estompée) et badge explicite du statut réel.
  const badge = courant === -1 ? statutCollecteDisplay(statut, 'admin') : null;
  const etapes: EtapeFriseClient[] = ETAPES.map((etape, i) => ({
    label:
      i === courant && statut === 'realisee_sans_collecte'
        ? statutCollecteDisplay(statut, 'admin').label
        : etape.label,
    etat: i < courant ? 'passee' : i === courant ? 'courante' : 'a_venir',
  }));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <FriseEtapes etapes={etapes} label="Avancement de la collecte" />
      {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
    </div>
  );
}
