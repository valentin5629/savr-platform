import { AppShell } from '@/components/layout/app-shell';
import { createSupabaseServerClient, getVerifiedClaims } from '@/lib/api-auth';
import { entreesNavMasquees } from '@/lib/nav-masquee';
import { chargerIdentiteOrganisation } from '@/lib/identite-organisation';
import { isStaff, type NavRole } from '@/lib/roles';

// Rendu à la demande : le menu dépend de la session. Sans ce marqueur, `next
// build` tente de pré-rendre les pages de la section, et ce layout crée le client
// Supabase avant toute lecture de cookie : le build échoue là où les variables
// Supabase sont absentes (CI), alors qu'il passe en local.
export const dynamic = 'force-dynamic';

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
  // Avatar + nom de l'organisation en en-tête, comme dans l'espace du rôle
  // (le staff n'en a pas : en-tête sans organisation).
  const organisation =
    !isStaff(claims?.role) && claims?.organisationId
      ? await chargerIdentiteOrganisation(claims.organisationId)
      : null;

  return (
    <AppShell
      role={role}
      organisation={organisation}
      pageTitle="Programmer une collecte"
      hiddenNavHrefs={hiddenNavHrefs}
    >
      {children}
    </AppShell>
  );
}
