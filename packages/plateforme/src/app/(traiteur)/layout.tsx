import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { chargerIdentiteSession } from '@/lib/identite-session';

const TRAITEUR_ROLES = ['traiteur_manager', 'traiteur_commercial'] as const;

export default async function TraiteurLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(TRAITEUR_ROLES);

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
