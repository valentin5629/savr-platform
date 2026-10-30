import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { chargerIdentiteSession } from '@/lib/identite-session';

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
      identite={await chargerIdentiteSession({
        userId: session.userId,
        email: session.email,
        logoAffichable: true,
      })}
      pageTitle="Mon impact RSE"
      hiddenNavHrefs={[]}
    >
      {children}
    </AppShell>
  );
}
