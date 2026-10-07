import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// La fiche lieu s'affiche désormais en pop-up sur la liste /gestionnaire/lieux
// (arbitrage Val 2026-10-06, même cadre que les fiches collecte). Cette route ne
// rend plus de page : elle redirige vers la liste avec la fiche ouverte
// (?lieu=<id>) pour préserver les liens directs et les favoris.
export default async function FicheLieuGestionnaireRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`${ROUTES.gestionnaire.lieux}?${new URLSearchParams({ lieu: id })}`);
}
