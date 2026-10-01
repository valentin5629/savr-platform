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
  title: string;
}

// Cadre commun des fiches collecte en pop-up (Admin + rôles clients), au format
// des fiches Admin (décision Val 2026-10-01) : le panneau fournit le grand
// en-tête, la barre d'onglets, le corps défilant et le pied ; hauteur fixe dès
// md (la modale ne bouge pas d'un onglet à l'autre). Plus de cadre coloré : le
// type est porté par le badge de l'en-tête. Le titre accessible (réservé aux
// lecteurs d'écran) est remonté par le panneau une fois la collecte chargée.
// Garde Escape : le panneau passe `blockCloseRef` à `true` quand une de ses
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

  // Réinitialisé à chaque changement de collecte pour ne pas annoncer
  // brièvement le titre de la fiche précédente.
  const [meta, setMeta] = useState<FicheCollecteMeta | null>(null);
  useEffect(() => {
    setMeta(null);
  }, [collecteId]);

  const handleClose = useCallback(() => {
    if (blockCloseRef.current) return;
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={collecteId != null}
      title={meta?.title ?? 'Collecte'}
      onClose={handleClose}
      hideTitle
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      className="max-w-5xl md:h-[min(90vh,48rem)]"
    >
      {collecteId != null && children({ onLoaded: setMeta, blockCloseRef })}
    </Modal>
  );
}

// Libellé d'affichage du type de collecte (UX — la DB garde l'enum).
export function typeCollecteLabel(type: string): string {
  return type === 'zero_dechet' ? 'Zéro Déchet' : 'Anti-Gaspi';
}
