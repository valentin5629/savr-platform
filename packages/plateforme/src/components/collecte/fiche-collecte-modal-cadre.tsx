'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { Modal } from '@/components/ui/modal';

export interface FicheCollecteMeta {
  type: 'anti_gaspi' | 'zero_dechet';
  title: string;
}

// Cadre coloré par type : orange (Anti-Gaspi) / vert (Zéro Déchet) — décision Val.
const BORDER_BY_TYPE: Record<FicheCollecteMeta['type'], string> = {
  anti_gaspi: 'border-4 border-savr-warning',
  zero_dechet: 'border-4 border-savr-success',
};

// Cadre commun des fiches collecte en pop-up (Admin + traiteur) : titre figé et
// couleur du cadre remontés par le panneau une fois la collecte chargée, et
// garde Escape — le panneau passe `blockCloseRef` à `true` quand une de ses
// sous-modales est ouverte. La modale externe ET la sous-modale écoutent toutes
// deux Escape au niveau `document` : sans cette garde, Escape fermerait les deux.
export function FicheCollecteModalCadre({
  collecteId,
  onClose,
  children,
}: {
  // null = fermé.
  collecteId: string | null;
  onClose: () => void;
  children: (panneau: {
    onLoaded: (meta: FicheCollecteMeta) => void;
    blockCloseRef: MutableRefObject<boolean>;
  }) => React.ReactNode;
}) {
  const blockCloseRef = useRef(false);

  // Réinitialisé à chaque changement de collecte pour ne pas afficher
  // brièvement le titre/cadre de la fiche précédente.
  const [meta, setMeta] = useState<FicheCollecteMeta | null>(null);
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
      className={`max-w-5xl ${borderClass}`.trim()}
    >
      {collecteId != null && children({ onLoaded: setMeta, blockCloseRef })}
    </Modal>
  );
}

// Libellé d'affichage du type de collecte (UX — la DB garde l'enum).
export function typeCollecteLabel(type: string): string {
  return type === 'zero_dechet' ? 'Zéro Déchet' : 'Anti-Gaspi';
}
