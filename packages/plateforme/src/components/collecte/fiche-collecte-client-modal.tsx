'use client';

import type { EspaceClient } from '@/lib/collectes/fiche-client-types';
import { FicheCollecteModalCadre } from './fiche-collecte-modal-cadre';
import {
  FicheCollecteClientPanel,
  type OngletFiche,
} from './fiche-collecte-client-panel';

// Pop-up centré des listes Collectes clientes (/traiteur, /agence,
// /gestionnaire) — refonte Val 2026-09-29. null = fermé.
export function FicheCollecteClientModal({
  espace,
  collecteId,
  initialEditing = false,
  initialOnglet,
  onClose,
}: {
  espace: EspaceClient;
  collecteId: string | null;
  initialEditing?: boolean;
  initialOnglet?: OngletFiche;
  onClose: () => void;
}) {
  return (
    <FicheCollecteModalCadre collecteId={collecteId} onClose={onClose}>
      {({ onLoaded, blockCloseRef }) => (
        <FicheCollecteClientPanel
          key={collecteId}
          espace={espace}
          collecteId={collecteId as string}
          initialEditing={initialEditing}
          initialOnglet={initialOnglet}
          onLoaded={onLoaded}
          blockCloseRef={blockCloseRef}
        />
      )}
    </FicheCollecteModalCadre>
  );
}
