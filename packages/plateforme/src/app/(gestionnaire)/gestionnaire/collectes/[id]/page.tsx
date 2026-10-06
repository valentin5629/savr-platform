import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// La fiche collecte s'affiche désormais dans le pop-up client commun (même
// format que le traiteur — refonte Val 2026-09-29) sur la liste
// /gestionnaire/collectes. Cette route ne rend plus de page : elle redirige vers la
// liste avec la fiche ouverte (?collecte=<id>) pour préserver les liens profonds
// (emails, dashboards, détail événement, favoris).
export default async function FicheCollecteGestionnaireRedirect({
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
  redirect(`${ROUTES.gestionnaire.collectes}?${qs.toString()}`);
}
