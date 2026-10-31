import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// « Mon profil » est un onglet de « Paramètres » (décision Val 2026-10-31) :
// l'ancienne adresse y renvoie.
export default function MonProfilPage() {
  redirect(ROUTES.agence.parametresProfil);
}
