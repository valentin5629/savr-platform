'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { Suspense } from 'react';
import { ListeCollectesClient } from '@/components/collecte/liste-collectes-client';

// Liste Collectes traiteur (§06.04 §3) — composant partagé avec l'agence (§06.11).
export default function TraiteurCollectesPage() {
  return (
    <Suspense fallback={<LoadingState className="p-4" />}>
      <ListeCollectesClient espace="traiteur" />
    </Suspense>
  );
}
