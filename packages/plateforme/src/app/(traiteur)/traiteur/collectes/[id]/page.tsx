import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// La fiche collecte traiteur s'affiche désormais dans le pop-up client commun
// (FicheCollecteClientModal, refonte Val 2026-09-29) sur la liste
// /traiteur/collectes. Cette route ne rend plus
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
  redirect(`${ROUTES.traiteur.collectes}?${qs.toString()}`);
}
