'use client';

import { FicheCollecteModalCadre } from '@/components/collecte/fiche-collecte-modal-cadre';
import { CollecteDetailPanel } from './collecte-detail-panel';

interface CollecteDetailModalProps {
  // Pop-up centré (modale) de la liste /admin/collectes : la fiche collecte
  // s'ouvre au clic sur une carte (plus de navigation vers la route [id], qui
  // redirige désormais vers ?collecte=<id>). null = fermé.
  collecteId: string | null;
  onClose: () => void;
}

// Titre accessible « Collecte AG · … · jusqu'à N pax » et garde Escape des
// sous-modales (forçage statut / nb camions / annuler crédit) : portés par le
// cadre commun aux fiches collecte Admin et clientes.
export function CollecteDetailModal({
  collecteId,
  onClose,
}: CollecteDetailModalProps) {
  return (
    <FicheCollecteModalCadre collecteId={collecteId} onClose={onClose}>
      {({ onLoaded, blockCloseRef }) => (
        <CollecteDetailPanel
          key={collecteId}
          collecteId={collecteId as string}
          onLoaded={onLoaded}
          blockCloseRef={blockCloseRef}
        />
      )}
    </FicheCollecteModalCadre>
  );
}
