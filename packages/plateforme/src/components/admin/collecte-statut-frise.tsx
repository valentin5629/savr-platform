import { Badge } from '@/components/ui/badge';
import {
  FriseEtapes,
  type EtapeFrise,
} from '@/components/collecte/frise-etapes';
import {
  ETAPES_STATUT_COLLECTE,
  RANG_STATUT_COLLECTE,
  statutCollecteDisplay,
  type StatutCollecteAdmin,
} from '@/lib/statut-collecte-labels';

// Parcours nominal d'une collecte côté Admin (Créée · Programmée · Validée ·
// En cours · Réalisée · Clôturée, décision Val 2026-10-07) — étapes, rangs et
// libellés : source unique `lib/statut-collecte-labels` (R-UI-2 C1).
const ETAPES = ETAPES_STATUT_COLLECTE.map((statut) => ({
  statut,
  label: statutCollecteDisplay(statut, 'admin').label,
}));

function indexEtape(statut: string): number {
  // AG « réalisée sans collecte » : même rang et même libellé que « Réalisée »
  // (« sans excédent » n'est pas un statut d'avancement, décision Val
  // 2026-10-09). Hors parcours → -1.
  return (RANG_STATUT_COLLECTE[statut as StatutCollecteAdmin] ?? 0) - 1;
}

// Frise d'avancement de la fiche collecte Admin (décision Val C2 2026-09-29) :
// granularité complète, au rendu compact de la frise client en haut à droite du
// grand en-tête (décision Val 2026-10-01). Le conteneur laisse la frise se
// replier (mobile) : elle ne doit jamais déborder de l'en-tête.
// `statut` = clé d'affichage Admin (`statutCollecteAdmin`), pas le statut DB
// brut : c'est elle qui sépare « Créée » de « Programmée ».
export function CollecteStatutFrise({
  statut,
}: {
  statut: StatutCollecteAdmin;
}) {
  const courant = indexEtape(statut);
  // Statut hors parcours (annulation demandée, annulé, rejeté, brouillon) : la
  // frise reste affichée (repère) mais aucune étape n'est marquée (frise
  // estompée), et un badge porte le statut réel.
  const badge = courant === -1 ? statutCollecteDisplay(statut, 'admin') : null;
  const etapes: EtapeFrise[] = ETAPES.map((etape, i) => ({
    label: etape.label,
    etat: i < courant ? 'passee' : i === courant ? 'courante' : 'a_venir',
  }));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <FriseEtapes etapes={etapes} label="Avancement de la collecte" />
      {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
    </div>
  );
}
