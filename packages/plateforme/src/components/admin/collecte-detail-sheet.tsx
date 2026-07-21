'use client';

import { useCallback, useRef } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { CollecteDetailPanel } from './collecte-detail-panel';

interface CollecteDetailSheetProps {
  // Panneau latéral (drawer) de la liste /admin/collectes : la fiche collecte
  // s'ouvre au clic sur une carte (plus de navigation vers la route [id], qui
  // redirige désormais vers ?collecte=<id>). null = fermé.
  collecteId: string | null;
  onClose: () => void;
}

export function CollecteDetailSheet({
  collecteId,
  onClose,
}: CollecteDetailSheetProps) {
  // Le panneau met ce drapeau à `true` quand une de ses sous-modales (forçage
  // statut / nb camions / annuler crédit) est ouverte. Modal ET Sheet écoutent
  // tous deux Escape au niveau `document` : sans cette garde, Escape fermerait
  // la sous-modale ET le panneau. On laisse alors la sous-modale se fermer seule.
  const blockCloseRef = useRef(false);

  const handleClose = useCallback(() => {
    if (blockCloseRef.current) return;
    onClose();
  }, [onClose]);

  return (
    <Sheet
      open={collecteId != null}
      title="Détail de la collecte"
      onClose={handleClose}
      className="sm:max-w-2xl lg:max-w-3xl"
    >
      {collecteId != null && (
        <CollecteDetailPanel
          key={collecteId}
          collecteId={collecteId}
          blockCloseRef={blockCloseRef}
        />
      )}
    </Sheet>
  );
}
