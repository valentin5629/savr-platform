'use client';

import { useParams } from 'next/navigation';
import { FormulaireProgrammation } from '@/components/programmation/formulaire-programmation';

// Reprise d'un brouillon dans le formulaire complet, modifiable (décision Val
// 2026-10-24, B2-Q2) : écrans 1 et 2 pré-remplis avec l'événement et toutes
// ses cartes ; « Enregistrer en brouillon » ou « Confirmer » remplace ses
// collectes.
export default function RepriseBrouillonPage() {
  const { id } = useParams<{ id: string }>();
  return <FormulaireProgrammation brouillonId={id} />;
}
