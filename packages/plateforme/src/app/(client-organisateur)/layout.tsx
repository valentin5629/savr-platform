import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { chargerIdentiteOrganisation } from '@/lib/identite-organisation';

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
      organisation={await chargerIdentiteOrganisation(session.organisationId)}
      pageTitle="Mon impact RSE"
      hiddenNavHrefs={[]}
    >
      {children}
    </AppShell>
  );
}
