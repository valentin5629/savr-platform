'use client';

import { Suspense } from 'react';
import { ListeCollectesClient } from '@/components/collecte/liste-collectes-client';

// Liste Collectes traiteur (§06.04 §3) — composant partagé avec l'agence (§06.11).
export default function TraiteurCollectesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <ListeCollectesClient espace="traiteur" />
    </Suspense>
  );
}
