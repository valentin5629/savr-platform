'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';

// Confirmation unique d'une modification de collecte (§06.04 l.501-507) :
// empile les avertissements applicables avant l'enregistrement. Commune au
// formulaire de la fiche collecte et à l'édition sur place de la carte de la
// fiche événement.
export function ConfirmationModificationCollecte({
  open,
  urgence,
  reacceptation,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  urgence: boolean;
  reacceptation: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Confirmer la modification"
      confirmLabel="Confirmer la modification"
      cancelLabel="Annuler"
      variant="primary"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <ul className="list-disc space-y-2 pl-5 text-sm text-savr-neutral-700">
        {urgence && (
          <li>
            Cette modification a lieu moins de 12h avant la collecte. Notre
            équipe Ops sera alertée en urgence.
          </li>
        )}
        {reacceptation && (
          <li>
            Ce nouveau créneau devra être reconfirmé par notre équipe
            logistique.
          </li>
        )}
      </ul>
    </ConfirmDialog>
  );
}
