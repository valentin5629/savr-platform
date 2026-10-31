import { ForkKnifeIcon, LeafIcon } from '@/components/ui/icones';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  classesAplatTypeCollecte,
  libelleCourtTypeCollecte,
  libelleTypeCollecte,
  normaliserTypeCollecte,
  variantTypeCollecte,
} from '@/lib/libelles/type-collecte';

// Badge unique du type de collecte (R-UI-2 C2). Couleurs : arbitrage Q1
// (Val, 2026-10-07) — ZD vert, AG navy, tenues par `lib/libelles/type-collecte.ts`.
// - `forme="pastille"` (défaut) : Badge + icône, libellé court ZD / AG — listes ;
// - `forme="plein"` : aplat, majuscules, libellé long — sur-titre des fiches
//   collecte (§06.04 Q2) ;
// - `forme="badge"` : même Badge sans icône — liste Transporteurs.
// `nombre` (pastille) : au-delà de 1, préfixe le libellé (« 2 ZD ») — colonne
// Collectes de la liste Événements (décision Val 2026-10-31).
// `data-testid="badge-type-collecte"` : forme `plein` seule (en-tête de fiche),
// pour ne pas dupliquer l'identifiant dans les listes.
export function TypeCollecteBadge({
  type,
  forme = 'pastille',
  nombre,
  className,
}: {
  type: string;
  forme?: 'pastille' | 'plein' | 'badge';
  nombre?: number;
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
  if (forme === 'badge') {
    return (
      <Badge
        variant={variantTypeCollecte(type)}
        dot={false}
        className={className}
      >
        {libelleCourtTypeCollecte(type)}
      </Badge>
    );
  }
  const ag = normaliserTypeCollecte(type) === 'anti_gaspi';
  const Icone = ag ? ForkKnifeIcon : LeafIcon;
  return (
    <Badge
      variant={variantTypeCollecte(type)}
      dot={false}
      className={className}
    >
      <Icone className="h-3.5 w-3.5" aria-hidden="true" />
      {nombre != null && nombre > 1 && `${nombre} `}
      {libelleCourtTypeCollecte(type)}
    </Badge>
  );
}
