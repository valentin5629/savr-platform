'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { Suspense } from 'react';
import { ListeCollectesClient } from '@/components/collecte/liste-collectes-client';

// Liste Collectes agence : « vue liste et fiche collecte identiques au §06.04 »
// (§06.11 « Liste Collectes ») → même composant que le traiteur, scopé sur le
// périmètre donneur d'ordre par les routes /api/v1/agence/collectes…
export default function AgenceCollectesPage() {
  return (
    <Suspense fallback={<LoadingState className="p-4" />}>
      <ListeCollectesClient espace="agence" />
    </Suspense>
  );
}
