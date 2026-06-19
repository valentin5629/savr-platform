import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';

// Registre réglementaire ZD (§06.03) — espace client, tous les rôles SAUF
// l'agence (donneuse d'ordre, non productrice — §09 F6). Le staff accède aux
// données via l'API/back-office ; cette page sert les rôles avec organisation.
const REGISTRE_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'gestionnaire_lieux',
  'client_organisateur',
] as const;

export default async function RegistreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(REGISTRE_ROLES);

  return (
    <AppShell
      role={session.role}
      userName={session.email}
      pageTitle="Registre réglementaire"
    >
      {children}
    </AppShell>
  );
}
