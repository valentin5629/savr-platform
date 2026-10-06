import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { entreesNavMasquees } from '@/lib/nav-masquee';

const GESTIONNAIRE_ROLES = ['gestionnaire_lieux'] as const;

export default async function GestionnaireLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(GESTIONNAIRE_ROLES);

  // §06.05 l.75 — « Mon pack AG » masqué si l'organisation n'a aucun pack.
  const hiddenNavHrefs = await entreesNavMasquees(session.role);

  return (
    <AppShell
      role={session.role}
      userName={session.email}
      pageTitle="Espace gestionnaire de lieux"
      hiddenNavHrefs={hiddenNavHrefs}
    >
      {children}
    </AppShell>
  );
}
