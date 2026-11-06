import { ListeEvenements } from '@/components/evenements/liste-evenements';

// Liste Événements, commune à tous les rôles (décision Val 2026-10-29).
export default function OrganisateurEvenementsPage() {
  return <ListeEvenements espace="organisateur" />;
}
