import { Leaf, UtensilsCrossed } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

// Badge de type de collecte des listes Collectes (Data Table) — même levier
// couleur que la liste Admin historique : AG ambre, ZD vert.
export function TypeCollecteBadge({ type }: { type: string }) {
  const ag = type === 'anti_gaspi';
  const Icone = ag ? UtensilsCrossed : Leaf;
  return (
    <Badge variant={ag ? 'warning' : 'success'} dot={false}>
      <Icone className="h-3.5 w-3.5" aria-hidden="true" />
      {ag ? 'AG' : 'ZD'}
    </Badge>
  );
}
