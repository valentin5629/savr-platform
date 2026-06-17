import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';

const GESTIONNAIRE_ROLES = ['gestionnaire_lieux'] as const;

export default async function GestionnaireLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(GESTIONNAIRE_ROLES);

  return (
    <AppShell
      role={session.role}
      userName={session.email}
      pageTitle="Espace gestionnaire de lieux"
    >
      {children}
    </AppShell>
  );
}
