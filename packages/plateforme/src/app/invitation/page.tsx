// /invitation?jeton=… — page du lien de l'email d'invitation (CDC §06.02 §17,
// lien valable 7 jours, décision Val 2026-10-28). Ouvrir la page ne consomme
// rien : seul l'envoi du mot de passe utilise le lien. Une messagerie qui
// analyse les liens (Outlook) ne peut donc pas le griller avant le clic.

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { lireEtatInvitation } from '@/lib/auth/etat-invitation';
import { FormulaireInvitation } from './formulaire-invitation';
import { CarteLienInvitation } from './carte-lien-invitation';

export const dynamic = 'force-dynamic';

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ jeton?: string | string[] }>;
}) {
  const { jeton } = await searchParams;
  const valeur = typeof jeton === 'string' ? jeton : '';
  const etat = await lireEtatInvitation(createAdminSupabaseClient(), valeur);
  if (!etat.ok) return <CarteLienInvitation motif={etat.motif} />;
  return (
    <FormulaireInvitation
      jeton={valeur}
      prenom={etat.prenom}
      email={etat.email}
    />
  );
}
