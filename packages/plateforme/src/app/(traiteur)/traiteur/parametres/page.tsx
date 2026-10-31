import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';
import { ChangerMotDePassePanel } from '@/components/compte/changer-mot-de-passe-panel';
import { SecuriteAccesPanel } from '@/components/compte/securite-acces-panel';
import { ParametresTraiteurClient } from './parametres-client';

const TRAITEUR_ROLES = ['traiteur_manager', 'traiteur_commercial'] as const;

// « Paramètres » traiteur = ex « Mon organisation » (CDC §06.04 §6) + ex « Mon
// profil », réunis en onglets (décision Val 2026-10-31). Visible manager +
// commercial. Le gating est DOUBLE : ici, côté serveur, on ne passe `isManager`
// au client que si le rôle de la SESSION l'est (jamais dérivé du client) ; et
// chaque route d'écriture re-vérifie `traiteur_manager` (defense-in-depth). Le
// commercial est en lecture seule ; dans Équipe il invite et transfère ses
// collectes (Val 2026-10-30).
export default async function ParametresTraiteurPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string | string[] }>;
}) {
  const session = await requirePageSession(TRAITEUR_ROLES);
  const { onglet } = await searchParams;

  // `userId` vient de la SESSION serveur (jamais du client) : il sert à griser
  // le sélecteur de rôle de sa propre ligne dans Équipe — un manager ne change
  // pas son propre rôle (volet 3 du trigger anti-escalade, 20260921170000).
  return (
    <ParametresTraiteurClient
      isManager={session.role === 'traiteur_manager'}
      userId={session.userId}
      initial={onglet}
      profil={
        <>
          <Card>
            <CardHeader>
              <CardTitle>Compte</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-savr-neutral-500">Email : </span>
                {session.email}
              </div>
              <div>
                <span className="text-savr-neutral-500">Rôle : </span>
                {session.role}
              </div>
            </CardContent>
          </Card>
          <ChangerMotDePassePanel />
          <SecuriteAccesPanel />
          <RgpdComptePanel />
        </>
      }
    />
  );
}
