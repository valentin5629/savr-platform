import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { chargerIdentiteOrganisation } from '@/lib/identite-organisation';

const AGENCE_ROLES = ['agence'] as const;

export default async function AgenceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(AGENCE_ROLES);

  return (
    <AppShell
      role={session.role}
      userName={session.email}
      organisation={await chargerIdentiteOrganisation(session.organisationId)}
      pageTitle="Espace agence"
      hiddenNavHrefs={[]}
    >
      {children}
    </AppShell>
  );
}
