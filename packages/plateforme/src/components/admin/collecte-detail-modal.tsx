'use client';

import { useCallback, useRef } from 'react';
import { Modal } from '@/components/ui/modal';
import { CollecteDetailPanel } from './collecte-detail-panel';

interface CollecteDetailModalProps {
  // Pop-up centré (modale) de la liste /admin/collectes : la fiche collecte
  // s'ouvre au clic sur une carte (plus de navigation vers la route [id], qui
  // redirige désormais vers ?collecte=<id>). null = fermé.
  collecteId: string | null;
  onClose: () => void;
}

export function CollecteDetailModal({
  collecteId,
  onClose,
}: CollecteDetailModalProps) {
  // Le panneau met ce drapeau à `true` quand une de ses sous-modales (forçage
  // statut / nb camions / annuler crédit) est ouverte. La modale externe ET la
  // sous-modale écoutent toutes deux Escape au niveau `document` : sans cette
  // garde, Escape fermerait la sous-modale ET la fiche. On laisse alors la
  // sous-modale se fermer seule (la fiche reste ouverte).
  const blockCloseRef = useRef(false);

  const handleClose = useCallback(() => {
    if (blockCloseRef.current) return;
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={collecteId != null}
      title="Détail de la collecte"
      onClose={handleClose}
      wide
    >
      {collecteId != null && (
        <CollecteDetailPanel
          key={collecteId}
          collecteId={collecteId}
          blockCloseRef={blockCloseRef}
        />
      )}
    </Modal>
  );
}
