'use client';

import { AlertBar } from '@/components/ui/alert-bar';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import {
  estAnnulationTardive,
  SEUIL_ANNULATION_TARDIVE_HEURES,
} from '@/lib/annulation-tardive';

// AnnulationCollecteDialog — confirmation d'annulation d'une collecte côté
// client (R-UI-3, G1). Une seule modale pour
// la liste et la fiche : le texte, la mention crédit AG et le motif facultatif
// étaient copiés entre `liste-collectes-client` et `fiche-collecte-client-panel`.
//
// Annulation à moins de 4 h du créneau (§05, même seuil et même heure de Paris
// que le pack en base) : avertissement au lieu de « crédit rendu » pour une AG,
// et rappel du plein tarif pour une ZD (Val 2026-11-01). Le crédit d'une AG
// sous pack est décompté dès la programmation (Val 2026-11-02) : rendu à une
// annulation à temps, gardé à une annulation tardive. La modale ne sait pas si
// la collecte porte un pack (programmée sans crédit = facturée à l'unité) :
// ses phrases tiennent dans les deux cas. L'heure
// est celle de l'appareil à l'ouverture ; la base juge à l'instant de
// l'écriture.
export interface AnnulationCollecteDialogProps {
  open: boolean;
  /** Collecte Anti-Gaspi : mention du crédit (rendu, ou gardé si tardive). */
  antiGaspi: boolean;
  /** Créneau de la collecte, pour repérer une annulation à moins de 4 h. */
  dateCollecte: string | null | undefined;
  heureCollecte: string | null | undefined;
  loading?: boolean;
  error?: string | null;
  onConfirm: (motif: string) => void;
  onCancel: () => void;
}

export function AnnulationCollecteDialog({
  open,
  antiGaspi,
  dateCollecte,
  heureCollecte,
  loading,
  error,
  onConfirm,
  onCancel,
}: AnnulationCollecteDialogProps) {
  const tardive =
    open && !!dateCollecte
      ? estAnnulationTardive(dateCollecte, heureCollecte, Date.now())
      : false;
  const delai = `Cette collecte a lieu dans moins de ${SEUIL_ANNULATION_TARDIVE_HEURES} h`;
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
      {tardive ? (
        <AlertBar variant="warn" data-testid="mention-annulation-tardive">
          {antiGaspi
            ? `${delai} : son annulation est facturée comme une collecte réalisée. Le crédit de votre pack Anti-Gaspi décompté à sa programmation ne vous est pas rendu.`
            : `${delai} : son annulation est facturée au plein tarif.`}
        </AlertBar>
      ) : (
        antiGaspi && (
          // Information persistante dans la confirmation (pas un succès
          // d'action) : bandeau AlertBar success, pas un toast (R-UI-1 H1/H2).
          <AlertBar variant="success" data-testid="mention-credit-ag">
            Si cette collecte a décompté un crédit de votre pack Anti-Gaspi à sa
            programmation, il vous est rendu.
          </AlertBar>
        )
      )}
    </ConfirmDialog>
  );
}
