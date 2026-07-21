import { redirect } from 'next/navigation';

// La fiche collecte Admin s'affiche désormais dans un panneau latéral (drawer)
// sur la liste /admin/collectes (composant CollecteDetailSheet). Cette route ne
// rend plus de page : elle redirige vers la liste avec le panneau ouvert
// (?collecte=<id>) pour préserver les liens profonds (emails, favoris, drill-down
// des dashboards). Composant serveur → redirection avant tout rendu.
export default async function CollecteDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/collectes?collecte=${encodeURIComponent(id)}`);
}
