import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';
import { SecuriteAccesPanel } from '@/components/compte/securite-acces-panel';
import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card';
import { ParametresOnglets } from '@/components/parametres/parametres-onglets';
import { ONGLET_ORGANISATION, ONGLET_PROFIL } from '@/lib/routes';

const ORGANISATEUR_ROLES = ['client_organisateur'] as const;

// « Paramètres » client organisateur = ex « Mon organisation » + ex « Mon
// profil », réunis en onglets (décision Val 2026-10-31). Pas de section
// organisation au CDC pour ce rôle : ajoutée par décision Val 2026-09-28
// (informations légales modifiables par tous les rôles). BL-P3-13 : « Sécurité
// du compte » (historique self des accès admin, rôle impersonable §15 §2.3).
export default async function ParametresOrganisateurPage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string | string[] }>;
}) {
  const session = await requirePageSession(ORGANISATEUR_ROLES);
  const { onglet } = await searchParams;

  return (
    <ParametresOnglets
      initial={onglet}
      onglets={[
        {
          value: ONGLET_PROFIL,
          label: 'Mon profil',
          contenu: (
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
              <SecuriteAccesPanel />
              <RgpdComptePanel />
            </>
          ),
        },
        {
          value: ONGLET_ORGANISATION,
          label: 'Organisation',
          contenu: (
            <InfosLegalesOrganisation urlProfil="/api/v1/organisateur/mon-organisation/profil" />
          ),
        },
      ]}
    />
  );
}
