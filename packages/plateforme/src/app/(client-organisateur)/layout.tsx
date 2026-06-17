import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';

const ORGANISATEUR_ROLES = ['client_organisateur'] as const;

export default async function ClientOrganisateurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(ORGANISATEUR_ROLES);

  return (
    <AppShell
      role={session.role}
      userName={session.email}
      pageTitle="Mon impact RSE"
    >
      {children}
    </AppShell>
  );
}
