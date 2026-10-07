import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// La fiche traiteur s'affiche désormais en pop-up sur la liste
// /gestionnaire/traiteurs (arbitrage Val 2026-10-07, même cadre que la fiche
// lieu). Cette route ne rend plus de page : elle redirige vers la liste avec la
// fiche ouverte (?traiteur=<id>) pour préserver les liens directs et les favoris.
export default async function FicheTraiteurGestionnaireRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(
    `${ROUTES.gestionnaire.traiteurs}?${new URLSearchParams({ traiteur: id })}`,
  );
}
