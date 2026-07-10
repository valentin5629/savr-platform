import { Truck } from 'lucide-react';

import { plaqueTmsComplete } from '@/lib/statut-tms-labels';

// BL-P3-12 — Picto « plaque TMS » de la fiche collecte Admin (CDC §11 l.210).
// Vert si toutes les tournées ont leur plaque communiquée, gris sinon. Monitoring
// interne Admin (le picto « plaque demandée » côté client a été retiré V1).
export function PlaqueTmsPicto({
  tournees,
}: {
  tournees: { tournees: { plaque_immatriculation: string | null } }[];
}) {
  const complete = plaqueTmsComplete(tournees);
  return (
    <span
      data-testid="picto-plaque-tms"
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${
        complete
          ? 'bg-savr-success-subtle text-savr-success-600'
          : 'bg-savr-neutral-100 text-savr-neutral-400'
      }`}
      title={
        complete
          ? 'Plaque(s) TMS communiquée(s) pour toutes les tournées'
          : 'Plaque TMS manquante sur au moins une tournée'
      }
      aria-label={complete ? 'Plaque TMS communiquée' : 'Plaque TMS manquante'}
    >
      <Truck className="h-3.5 w-3.5" aria-hidden="true" />
      Plaque TMS
    </span>
  );
}
