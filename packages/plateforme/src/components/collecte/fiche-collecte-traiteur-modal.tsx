'use client';

import { FicheCollecteModalCadre } from './fiche-collecte-modal-cadre';
import { FicheCollecteTraiteurPanel } from './fiche-collecte-traiteur-panel';

// Pop-up centré de la liste /traiteur/collectes — même cadre que la fiche
// Admin (décision Val 2026-09-29). null = fermé.
export function FicheCollecteTraiteurModal({
  collecteId,
  initialEditing = false,
  onClose,
}: {
  collecteId: string | null;
  initialEditing?: boolean;
  onClose: () => void;
}) {
  return (
    <FicheCollecteModalCadre collecteId={collecteId} onClose={onClose}>
      {({ onLoaded, blockCloseRef }) => (
        <FicheCollecteTraiteurPanel
          key={collecteId}
          collecteId={collecteId as string}
          initialEditing={initialEditing}
          onLoaded={onLoaded}
          blockCloseRef={blockCloseRef}
        />
      )}
    </FicheCollecteModalCadre>
  );
}
