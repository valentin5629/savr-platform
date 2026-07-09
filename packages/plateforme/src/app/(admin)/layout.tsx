import { AppShell } from '@/components/layout/app-shell';
import { requireStaffPage } from '@/lib/page-auth';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

// Pastille nav « Alertes » : nombre d'alertes Admin in-app ouvertes. Requêté
// côté serveur (count-only) pour éviter le flash client, réservé à admin_savr
// (la policy RLS aa_admin est admin-only ; ops ne peut pas ouvrir l'écran).
// Best-effort : jamais bloquant pour le rendu du back-office.
async function fetchAlertesOuvertes(): Promise<number> {
  try {
    const supabase = createAdminSupabaseClient();
    const { count } = await supabase
      .from('alertes_admin')
      .select('id', { count: 'exact', head: true })
      .eq('statut', 'ouverte');
    return count ?? 0;
  } catch {
    return 0;
  }
}

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

  const navBadges =
    session.role === 'admin_savr'
      ? { '/admin/alertes': await fetchAlertesOuvertes() }
      : undefined;

  return (
    <AppShell
      role="admin_savr"
      userName={session.email}
      pageTitle="Back-office Admin"
      navBadges={navBadges}
    >
      {children}
    </AppShell>
  );
}
