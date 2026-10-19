import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// La fiche événement s'affiche en pop-up sur la liste /gestionnaire/evenements
// (demande Val 2026-10-19, même cadre que les fiches collecte et lieu). Cette
// route ne rend plus de page : elle redirige vers la liste avec la fiche
// ouverte (?evenement=<id>, et ?collecte=<id> si une fiche collecte était
// ouverte par-dessus) pour préserver les liens directs et les favoris.
export default async function FicheEvenementGestionnaireRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { collecte } = await searchParams;
  const qs = new URLSearchParams({ evenement: id });
  if (typeof collecte === 'string' && collecte) qs.set('collecte', collecte);
  redirect(`${ROUTES.gestionnaire.evenements}?${qs.toString()}`);
}
