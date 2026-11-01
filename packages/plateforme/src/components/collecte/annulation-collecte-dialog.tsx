'use client';

import { AlertBar } from '@/components/ui/alert-bar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';

// AnnulationCollecteDialog — confirmation d'annulation d'une collecte côté
// client (R-UI-3, G1). Une seule modale pour
// la liste et la fiche : le texte, la mention crédit AG et le motif facultatif
// étaient copiés entre `liste-collectes-client` et `fiche-collecte-client-panel`.
export interface AnnulationCollecteDialogProps {
  open: boolean;
  /** Collecte Anti-Gaspi : mention « crédit préservé ». */
  antiGaspi: boolean;
  loading?: boolean;
  error?: string | null;
  onConfirm: (motif: string) => void;
  onCancel: () => void;
}

export function AnnulationCollecteDialog({
  open,
  antiGaspi,
  loading,
  error,
  onConfirm,
  onCancel,
}: AnnulationCollecteDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      title="Annuler la collecte"
      confirmLabel="Confirmer l’annulation"
      cancelLabel="Retour"
      variant="destructive"
      loading={loading}
      error={error}
      motif={{ label: 'Motif' }}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <Text>
        Cette collecte sera annulée immédiatement. Nous prévenons notre équipe
        logistique.
      </Text>
      {antiGaspi && (
        // Information persistante dans la confirmation (pas un succès
        // d'action) : bandeau AlertBar success, pas un toast (R-UI-1 H1/H2).
        <AlertBar variant="success" data-testid="mention-credit-ag">
          Votre crédit Anti-Gaspi sera préservé : il n’a pas encore été débité
          (annulation avant réalisation de la collecte).
        </AlertBar>
      )}
    </ConfirmDialog>
  );
}
