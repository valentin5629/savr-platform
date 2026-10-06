import { AppShell } from '@/components/layout/app-shell';
import { createSupabaseServerClient, getVerifiedClaims } from '@/lib/api-auth';
import { entreesNavMasquees } from '@/lib/nav-masquee';
import { isStaff, type NavRole } from '@/lib/roles';

export default async function ProgrammationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Le rôle pilote la nav de l'AppShell ; il est lu côté serveur dans le claim
  // `user_role`. `ops_savr` n'a pas de nav propre : il partage celle
  // d'`admin_savr` (cf. `NavRole`), comme dans le layout (admin). Le middleware
  // garde l'accès à la section ; sans rôle lisible, défaut `traiteur_commercial`.
  const claims = await getVerifiedClaims(
    createSupabaseServerClient({ readonly: true }),
  );
  const role: NavRole = isStaff(claims?.role)
    ? 'admin_savr'
    : ((claims?.role ?? 'traiteur_commercial') as NavRole);
  const hiddenNavHrefs = await entreesNavMasquees(role);

  return (
    <AppShell
      role={role}
      pageTitle="Programmer une collecte"
      hiddenNavHrefs={hiddenNavHrefs}
    >
      {children}
    </AppShell>
  );
}
