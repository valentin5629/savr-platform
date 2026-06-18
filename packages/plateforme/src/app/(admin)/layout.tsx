import { AppShell } from '@/components/layout/app-shell';
import { requireStaffPage } from '@/lib/page-auth';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Garde serveur : seuls admin_savr / ops_savr accèdent au back-office.
  // Sans ceci, le groupe (admin) était le seul sans requirePageSession → un
  // rôle non-staff pouvait charger /admin/* (cloisonnement). Défense en
  // profondeur côté Server Component, en plus du middleware.
  const session = await requireStaffPage();

  return (
    <AppShell
      role="admin_savr"
      userName={session.email}
      pageTitle="Back-office Admin"
    >
      {children}
    </AppShell>
  );
}
