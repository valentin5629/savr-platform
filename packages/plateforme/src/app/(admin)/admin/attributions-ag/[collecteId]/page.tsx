'use client';

// Écran d'attribution AG (§06.09) — même formulaire que l'onglet Logistique de la
// fiche collecte (décision Val 2026-10-01 : attribution intégrée à la fiche).
// Conservé pour l'accès depuis la liste « AG en attente d'attribution » ; après
// validation, retour à cette file.

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeftIcon, LeafIcon } from '@/components/ui/icones';

import { IconButton } from '@/components/ui/icon-button';
import { AttributionAgForm } from '@/components/admin/attribution-ag-form';
import { ROUTES } from '@/lib/routes';
import { PageHero } from '@/components/ui/page-hero';

export default function AttributionDetailPage() {
  const { collecteId } = useParams<{ collecteId: string }>();
  const router = useRouter();
  // Redirection différée après succès : annulée si l'Admin quitte l'écran avant.
  const redirectionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (redirectionRef.current) clearTimeout(redirectionRef.current);
    },
    [],
  );

  return (
    <div className="space-y-6">
      <PageHero
        icon={
          <div className="flex items-center gap-2">
            <IconButton
              aria-label="Retour"
              onClick={() => router.back()}
              className="text-savr-primary-700 hover:bg-savr-primary-200/60 hover:text-savr-primary-800"
            >
              <ArrowLeftIcon />
            </IconButton>
            <LeafIcon className="h-6 w-6" />
          </div>
        }
        title="Attribution AG"
      />

      <AttributionAgForm
        collecteId={collecteId}
        onValidee={() => {
          // La file d'attribution vit dans Collectes (chip « AG en attente
          // attribution », §06.09 §1) : il n'existe pas de page /admin/attributions-ag.
          redirectionRef.current = setTimeout(
            () =>
              router.push(
                `${ROUTES.admin.collectes}?chip=ag_attente_attribution`,
              ),
            2000,
          );
        }}
      />
    </div>
  );
}
