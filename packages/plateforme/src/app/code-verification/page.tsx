import { redirect } from 'next/navigation';

import { AuthPage } from '@/components/auth/auth-card';
import { createSupabaseServerClient } from '@/lib/api-auth';
import { lireSessionCodeVerification } from '@/lib/auth/session-code-verification';
import {
  codeVerificationManquant,
  exigeCodeVerification,
  facteursTotp,
} from '@/lib/code-verification';
import { ROUTES } from '@/lib/routes';
import { safeNextPath } from '@/lib/safe-next-path';

import { FormulaireCodeVerification } from './formulaire-code-verification';

// Écran du code de vérification de l'équipe Savr (lib/code-verification.ts) :
// activation (QR code) si le compte n'a pas encore de code, saisie sinon. Le
// middleware y envoie toute session de l'équipe Savr qui ne l'a pas passé, avec
// la page demandée en `next`.
export const dynamic = 'force-dynamic';

export default async function CodeVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Jamais de retour vers cet écran lui-même (boucle une fois le code passé).
  const demande = safeNextPath(next);
  const suite = demande.startsWith(ROUTES.codeVerification)
    ? ROUTES.racine
    : demande;

  const session = await lireSessionCodeVerification(
    createSupabaseServerClient({ readonly: true }),
  );
  if (!session) redirect(ROUTES.login);
  // Aucun code pour ce compte (client, ou équipe Savr hors production) : la
  // page demandée directement.
  if (!exigeCodeVerification(session.role)) redirect(suite);
  // Code déjà passé sur cette session.
  if (!codeVerificationManquant(session.role, session.aal)) redirect(suite);

  const actif = facteursTotp(session.user.factors).verifies.length > 0;

  return (
    <AuthPage>
      <FormulaireCodeVerification
        mode={actif ? 'saisie' : 'activation'}
        suite={suite}
      />
    </AuthPage>
  );
}
