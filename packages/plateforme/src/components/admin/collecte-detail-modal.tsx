'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { CollecteDetailPanel } from './collecte-detail-panel';

interface CollecteDetailModalProps {
  // Pop-up centré (modale) de la liste /admin/collectes : la fiche collecte
  // s'ouvre au clic sur une carte (plus de navigation vers la route [id], qui
  // redirige désormais vers ?collecte=<id>). null = fermé.
  collecteId: string | null;
  onClose: () => void;
}

// Cadre coloré par type : orange (Anti-Gaspi) / vert (Zéro Déchet) — décision Val.
const BORDER_BY_TYPE: Record<'anti_gaspi' | 'zero_dechet', string> = {
  anti_gaspi: 'border-4 border-savr-warning',
  zero_dechet: 'border-4 border-savr-success',
};

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

  // Type + titre-résumé remontés par le panneau une fois la collecte chargée :
  // pilotent le titre figé de l'en-tête (« Collecte AG · … · jusqu'à N pax ») et
  // la couleur du cadre. Réinitialisés à chaque changement de collecte pour ne
  // pas afficher brièvement le titre/cadre de la fiche précédente.
  const [meta, setMeta] = useState<{
    type: 'anti_gaspi' | 'zero_dechet';
    title: string;
  } | null>(null);
  useEffect(() => {
    setMeta(null);
  }, [collecteId]);

  const handleClose = useCallback(() => {
    if (blockCloseRef.current) return;
    onClose();
  }, [onClose]);

  const borderClass = meta ? BORDER_BY_TYPE[meta.type] : '';

  return (
    <Modal
      open={collecteId != null}
      title={meta?.title ?? 'Collecte'}
      onClose={handleClose}
      className={`max-w-4xl ${borderClass}`.trim()}
    >
      {collecteId != null && (
        <CollecteDetailPanel
          key={collecteId}
          collecteId={collecteId}
          onLoaded={setMeta}
          blockCloseRef={blockCloseRef}
        />
      )}
    </Modal>
  );
}
