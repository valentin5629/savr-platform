import { cn } from '@/lib/utils';
import {
  RANG_STATUT_COLLECTE,
  statutCollecteDisplay,
  type StatutCollecteAdmin,
} from '@/lib/statut-collecte-labels';

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
const TON_SABLE = {
  fond: 'bg-savr-sable-100 text-savr-neutral-700',
  point: 'bg-savr-neutral-400',
};
const TON_BLEU = {
  fond: 'bg-savr-primary-50 text-savr-primary-700',
  point: 'bg-savr-primary-700',
};
const TON_ORANGE = {
  fond: 'bg-savr-accent-50 text-savr-accent-800',
  point: 'bg-savr-accent-500',
};
const TON_VERT = {
  fond: 'bg-savr-success-subtle text-savr-success-strong',
  point: 'bg-savr-success',
};
const TONS = [
  TON_SABLE,
  TON_SABLE,
  TON_BLEU,
  TON_BLEU,
  TON_ORANGE,
  TON_VERT,
  TON_VERT,
] as const;
const TON_ERREUR = {
  fond: 'bg-savr-error-subtle text-savr-error-strong',
  point: 'bg-savr-error',
};

export function CollecteStatutPastille({
  statut,
}: {
  statut: StatutCollecteAdmin;
}) {
  const { label, variant } = statutCollecteDisplay(statut, 'admin');
  const ton =
    variant === 'error'
      ? TON_ERREUR
      : (TONS[RANG_STATUT_COLLECTE[statut] ?? 0] ?? TON_SABLE);
  return (
    <span
      data-testid="statut-collecte-admin"
      aria-label={`Statut de la collecte : ${label}`}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2.5 rounded-savr-full px-4 text-sm font-semibold',
        ton.fond,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-savr-full', ton.point)}
      />
      {label}
    </span>
  );
}
