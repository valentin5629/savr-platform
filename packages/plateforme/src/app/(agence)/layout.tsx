import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';

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
      pageTitle="Espace agence"
    >
      {children}
    </AppShell>
  );
}
