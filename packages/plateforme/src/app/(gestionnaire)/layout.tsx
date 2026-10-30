import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { chargerIdentiteSession } from '@/lib/identite-session';
import { entreesNavMasquees } from '@/lib/nav-masquee';

const GESTIONNAIRE_ROLES = ['gestionnaire_lieux'] as const;

export default async function GestionnaireLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(GESTIONNAIRE_ROLES);

  const hiddenNavHrefs = await entreesNavMasquees(session.role);

  return (
    <AppShell
      role={session.role}
      identite={await chargerIdentiteSession({
        userId: session.userId,
        email: session.email,
        logoAffichable: true,
      })}
      pageTitle="Espace gestionnaire de lieux"
      hiddenNavHrefs={hiddenNavHrefs}
    >
      {children}
    </AppShell>
  );
}
