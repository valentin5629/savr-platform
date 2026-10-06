import { AppShell } from '@/components/layout/app-shell';
import { requirePageSession } from '@/lib/page-auth';
import { createSupabaseServerClient } from '@/lib/api-auth';
import { ROUTES } from '@/lib/routes';

const GESTIONNAIRE_ROLES = ['gestionnaire_lieux'] as const;

export default async function GestionnaireLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requirePageSession(GESTIONNAIRE_ROLES);

  // §06.05 l.71 — « Mon pack AG » masqué si l'organisation n'a AUCUN pack
  // (packs_antgaspi WHERE organisation_id = current_org). La RLS scope déjà
  // packs_antgaspi à l'organisation de l'appelant → un simple count des lignes
  // visibles suffit (pattern identique à la route pack-ag).
  const supabase = createSupabaseServerClient();
  const { count } = await supabase
    .from('packs_antgaspi')
    .select('id', { count: 'exact', head: true });
  const hiddenNavHrefs =
    (count ?? 0) > 0 ? [] : [ROUTES.gestionnaire.monPackAg];

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
