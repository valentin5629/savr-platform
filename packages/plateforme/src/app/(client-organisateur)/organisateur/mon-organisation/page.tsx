import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// « Mon organisation » vit dans « Paramètres » (décision Val 2026-10-31) :
// l'ancienne adresse y renvoie.
export default function MonOrganisationPage() {
  redirect(ROUTES.organisateur.parametresOrganisation);
}
