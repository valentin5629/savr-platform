import {
  RANG_STATUT_COLLECTE,
  statutCollecteDisplay,
  type StatutCollecteAdmin,
} from '@/lib/statut-collecte-labels';
import {
  FichePastille,
  type TonPastille,
} from '@/components/ui/fiche/fiche-pastille';

// Statut de la fiche collecte Admin : une pastille à droite du titre, comme la
// fiche client (variante B, décision Val 2026-10-27 — remplace la frise à six
// étapes). Libellés Admin : Créée · Programmée · Validée · En cours · Réalisée ·
// Clôturée ; une AG sans excédent se lit « Réalisée » (décision Val
// 2026-10-09). Hors parcours (annulation demandée, annulée, rejetée) : pastille
// rouge ; brouillon : pastille neutre.
// `statut` = clé d'affichage Admin (`statutCollecteAdmin`), pas le statut DB
// brut : c'est elle qui sépare « Créée » de « Programmée ».
// Rang du parcours (0 = hors parcours) → ton : Créée sable, Programmée et
// Validée bleu, En cours orange, Réalisée et Clôturée vert.
const TONS: readonly TonPastille[] = [
  'sable',
  'sable',
  'bleu',
  'bleu',
  'orange',
  'vert',
  'vert',
];

export function CollecteStatutPastille({
  statut,
}: {
  statut: StatutCollecteAdmin;
}) {
  const { label, variant } = statutCollecteDisplay(statut, 'admin');
  const ton: TonPastille =
    variant === 'error'
      ? 'rouge'
      : (TONS[RANG_STATUT_COLLECTE[statut] ?? 0] ?? 'sable');
  return (
    <FichePastille
      ton={ton}
      data-testid="statut-collecte-admin"
      aria-label={`Statut de la collecte : ${label}`}
    >
      {label}
    </FichePastille>
  );
}
