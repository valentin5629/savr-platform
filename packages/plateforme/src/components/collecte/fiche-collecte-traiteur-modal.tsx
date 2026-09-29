'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { FicheCollecteTraiteurPanel } from './fiche-collecte-traiteur-panel';

// Cadre coloré par type, comme la fiche Admin : orange (AG) / vert (ZD).
const BORDER_BY_TYPE: Record<'anti_gaspi' | 'zero_dechet', string> = {
  anti_gaspi: 'border-4 border-savr-warning',
  zero_dechet: 'border-4 border-savr-success',
};

interface FicheCollecteTraiteurModalProps {
  // Pop-up centré de la liste /traiteur/collectes (même format que la fiche
  // Admin, décision Val 2026-09-29). null = fermé.
  collecteId: string | null;
  initialEditing?: boolean;
  // `modifiee` = une action de la fiche a changé la collecte → la liste rafraîchit.
  onClose: (modifiee: boolean) => void;
}

export function FicheCollecteTraiteurModal({
  collecteId,
  initialEditing = false,
  onClose,
}: FicheCollecteTraiteurModalProps) {
  // Une sous-modale (annulation, programmée par) ouverte : Escape la ferme
  // seule, pas la fiche (les deux écoutent Escape au niveau document).
  const blockCloseRef = useRef(false);
  const modifieeRef = useRef(false);
  const [meta, setMeta] = useState<{
    type: 'anti_gaspi' | 'zero_dechet';
    title: string;
  } | null>(null);

  useEffect(() => {
    setMeta(null);
    modifieeRef.current = false;
  }, [collecteId]);

  const handleClose = useCallback(() => {
    if (blockCloseRef.current) return;
    onClose(modifieeRef.current);
  }, [onClose]);

  const onChanged = useCallback(() => {
    modifieeRef.current = true;
  }, []);

  const borderClass = meta ? BORDER_BY_TYPE[meta.type] : '';

  return (
    <Modal
      open={collecteId != null}
      title={meta?.title ?? 'Collecte'}
      onClose={handleClose}
      className={`max-w-5xl ${borderClass}`.trim()}
    >
      {collecteId != null && (
        <FicheCollecteTraiteurPanel
          key={collecteId}
          collecteId={collecteId}
          initialEditing={initialEditing}
          onLoaded={setMeta}
          onChanged={onChanged}
          blockCloseRef={blockCloseRef}
        />
      )}
    </Modal>
  );
}
