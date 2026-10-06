import { Leaf, UtensilsCrossed } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  classesAplatTypeCollecte,
  libelleCourtTypeCollecte,
  libelleTypeCollecte,
  normaliserTypeCollecte,
  variantTypeCollecte,
} from '@/lib/libelles/type-collecte';

// Badge unique du type de collecte (R-UI-2 C2) — remplace `TypeCollecteBadge`
// (listes Collectes) et `BadgeTypeCollecte` (sur-titre des fiches collecte).
// Arbitrage Q1 OUVERT : les deux rendus existants cohabitent, couleurs tenues
// par une seule source (`lib/libelles/type-collecte.ts`) :
// - `forme="pastille"` (défaut) : pilule ZD vert / AG ambre + icône, libellé
//   court ZD / AG — listes ;
// - `forme="plein"` : aplat ZD navy / AG orange, majuscules, libellé long —
//   sur-titre des fiches collecte (§06.04 Q2).
export function TypeCollecteBadge({
  type,
  forme = 'pastille',
  className,
}: {
  type: string;
  forme?: 'pastille' | 'plein';
  className?: string;
}) {
  if (forme === 'plein') {
    return (
      <span
        data-testid="badge-type-collecte"
        className={cn(
          'rounded-savr-sm px-2 py-0.5 text-xs font-bold uppercase tracking-[0.04em]',
          classesAplatTypeCollecte(type),
          className,
        )}
      >
        {libelleTypeCollecte(type)}
      </span>
    );
  }
  const ag = normaliserTypeCollecte(type) === 'anti_gaspi';
  const Icone = ag ? UtensilsCrossed : Leaf;
  return (
    <Badge
      variant={variantTypeCollecte(type)}
      dot={false}
      data-testid="badge-type-collecte"
      className={className}
    >
      <Icone className="h-3.5 w-3.5" aria-hidden="true" />
      {libelleCourtTypeCollecte(type)}
    </Badge>
  );
}
