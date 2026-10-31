import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { chargerIdentiteSession } from '@/lib/identite-session';

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
      identite={await chargerIdentiteSession({
        userId: session.userId,
        email: session.email,
        logoAffichable: true,
      })}
      hiddenNavHrefs={[]}
    >
      {children}
    </AppShell>
  );
}
