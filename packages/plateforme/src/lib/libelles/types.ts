/**
 * Variante de `Badge` qu'un libellé peut porter (sous-ensemble des variantes
 * de `components/ui/badge.tsx`, redéclaré ici pour que `lib/` ne dépende pas
 * des composants).
 */
export type VarianteBadge =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';
