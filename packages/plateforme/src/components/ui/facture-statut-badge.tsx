import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  libelleStatutFacture,
  variantStatutFacture,
} from '@/lib/libelles/facture';

// Badge de statut de facture (R-UI-2 C3) : libellé + couleur de
// `lib/libelles/facture.ts` (brouillon neutre, en attente Pennylane ambre,
// émise info, payée vert, annulée rouge).
export function FactureStatutBadge({
  statut,
  ...props
}: { statut: string | null | undefined } & Omit<
  BadgeProps,
  'variant' | 'children'
>) {
  return (
    <Badge variant={variantStatutFacture(statut)} {...props}>
      {libelleStatutFacture(statut)}
    </Badge>
  );
}
