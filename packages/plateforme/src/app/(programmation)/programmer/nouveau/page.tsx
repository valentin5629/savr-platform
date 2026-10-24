'use client';

import { FormulaireProgrammation } from '@/components/programmation/formulaire-programmation';

// Programmer une collecte (§06.01, refonte du formulaire, lot B2) : deux
// écrans, puis la page de confirmation. Pré-remplissage « Dupliquer » par
// `?from=<collecteId>` (lu par le formulaire).
export default function NouveauProgrammationPage() {
  return <FormulaireProgrammation />;
}
