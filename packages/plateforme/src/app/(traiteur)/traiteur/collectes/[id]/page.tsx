import { redirect } from 'next/navigation';

// La fiche collecte traiteur s'affiche désormais dans un pop-up centré (modale)
// sur la liste /traiteur/collectes (composant FicheCollecteTraiteurModal, même
// format que la fiche Admin — décision Val 2026-09-29). Cette route ne rend plus
// de page : elle redirige vers la liste avec la modale ouverte (?collecte=<id>)
// pour préserver les liens profonds (emails, dashboards, favoris).
export default async function FicheCollecteTraiteurRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const qs = new URLSearchParams({ collecte: id });
  if (edit === '1') qs.set('edit', '1');
  redirect(`/traiteur/collectes?${qs.toString()}`);
}
