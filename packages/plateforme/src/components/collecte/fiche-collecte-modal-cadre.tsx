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

// Cadre commun des fiches collecte en pop-up (Admin + rôles clients) : titre figé et
// couleur du cadre remontés par le panneau une fois la collecte chargée, et
// garde Escape — le panneau passe `blockCloseRef` à `true` quand une de ses
// sous-modales est ouverte. La modale externe ET la sous-modale écoutent toutes
// deux Escape au niveau `document` : sans cette garde, Escape fermerait les deux.
export function FicheCollecteModalCadre({
  collecteId,
  onClose,
  variante = 'admin',
  children,
}: {
  // null = fermé.
  collecteId: string | null;
  onClose: () => void;
  // 'client' (traiteur, agence, gestionnaire — refonte Val 2026-09-29) : pas de
  // cadre coloré (le type est porté par le badge de l'en-tête), titre réservé
  // aux lecteurs d'écran, corps sans marge — le panneau fournit en-tête, onglets
  // en colonne et pied, et gère lui-même le défilement.
  variante?: 'admin' | 'client';
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

  const client = variante === 'client';
  const borderClass = meta && !client ? BORDER_BY_TYPE[meta.type] : '';

  return (
    <Modal
      open={collecteId != null}
      title={meta?.title ?? 'Collecte'}
      onClose={handleClose}
      hideTitle={client}
      bodyClassName={
        client ? 'flex min-h-0 flex-col overflow-hidden p-0' : undefined
      }
      className={
        client
          ? 'max-w-6xl md:h-[min(90vh,52rem)]'
          : `max-w-5xl ${borderClass}`.trim()
      }
    >
      {collecteId != null && children({ onLoaded: setMeta, blockCloseRef })}
    </Modal>
  );
}

// Libellé d'affichage du type de collecte (UX — la DB garde l'enum).
export function typeCollecteLabel(type: string): string {
  return type === 'zero_dechet' ? 'Zéro Déchet' : 'Anti-Gaspi';
}
