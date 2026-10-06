import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  libelleActif,
  variantActif,
  type SujetActif,
} from '@/lib/libelles/actif';

// Badge Actif / Inactif d'un enregistrement (R-UI-2 C6) — remplace les
// ternaires `<Badge variant="success">Actif</Badge> : <Badge variant="neutral">…`
// recopiés écran par écran. Libellé selon le sujet (arbitrage Q2 OUVERT, cf.
// `lib/libelles/actif.ts`).
export function ActifBadge({
  actif,
  sujet = 'defaut',
  ...props
}: {
  actif: boolean;
  sujet?: SujetActif;
} & Omit<BadgeProps, 'variant' | 'children'>) {
  return (
    <Badge variant={variantActif(actif)} {...props}>
      {libelleActif(actif, sujet)}
    </Badge>
  );
}
