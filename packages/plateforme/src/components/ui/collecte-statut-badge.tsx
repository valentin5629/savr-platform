'use client';

import { Badge } from '@/components/ui/badge';
import {
  statutCollecteDisplay,
  type VueStatut,
} from '@/lib/statut-collecte-labels';

interface Props {
  statut: string;
  /** 'client' (défaut) = vue simplifiée non-admin ; 'admin' = granularité complète. */
  vue?: VueStatut;
  className?: string;
}

/**
 * Badge de statut de collecte avec libellé résolu selon la vue (UX-only).
 * Utilisé par les espaces non-admin (vue=client par défaut).
 */
export function CollecteStatutBadge({
  statut,
  vue = 'client',
  className,
}: Props) {
  const { label, variant } = statutCollecteDisplay(statut, vue);
  return (
    <Badge variant={variant} dot={false} className={className}>
      {label}
    </Badge>
  );
}
