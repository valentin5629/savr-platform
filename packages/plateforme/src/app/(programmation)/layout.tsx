import { AppShell } from '@/components/layout/app-shell';
import { createSupabaseServerClient, getVerifiedClaims } from '@/lib/api-auth';
import { entreesNavMasquees } from '@/lib/nav-masquee';
import { isStaff, type NavRole } from '@/lib/roles';

export default async function ProgrammationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Le rôle pilote la nav de l'AppShell. Il est lu côté serveur dans le claim
  // `user_role` de la session : le menu sort juste dès le premier rendu, avec les
  // mêmes entrées masquées que dans l'espace du rôle (§06.05 l.75, « Mon pack AG »).
  // Le middleware garde déjà l'accès à la section ; sans rôle lisible, on garde
  // le défaut historique `traiteur_commercial`. Le staff qui programme en
  // support garde le menu du back-office : `ops_savr` n'a pas de nav propre, il
  // partage celle d'`admin_savr` (cf. `NavRole`), comme dans le layout (admin).
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
