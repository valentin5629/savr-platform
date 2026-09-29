'use client';

import type { EspaceClient } from '@/lib/collectes/fiche-client-types';
import { FicheCollecteModalCadre } from './fiche-collecte-modal-cadre';
import { FicheCollecteClientPanel } from './fiche-collecte-client-panel';

// Pop-up centré des listes Collectes clientes (/traiteur, /agence,
// /gestionnaire) — refonte Val 2026-09-29. null = fermé.
export function FicheCollecteClientModal({
  espace,
  collecteId,
  initialEditing = false,
  onClose,
}: {
  espace: EspaceClient;
  collecteId: string | null;
  initialEditing?: boolean;
  onClose: () => void;
}) {
  return (
    <FicheCollecteModalCadre
      collecteId={collecteId}
      onClose={onClose}
      variante="client"
    >
      {({ onLoaded, blockCloseRef }) => (
        <FicheCollecteClientPanel
          key={collecteId}
          espace={espace}
          collecteId={collecteId as string}
          initialEditing={initialEditing}
          onLoaded={onLoaded}
          blockCloseRef={blockCloseRef}
        />
      )}
    </FicheCollecteModalCadre>
  );
}
