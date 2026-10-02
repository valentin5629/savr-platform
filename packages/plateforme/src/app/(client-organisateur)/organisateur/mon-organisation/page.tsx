import { requirePageSession } from '@/lib/page-auth';
import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card';
import { Heading } from '@/components/ui/heading';

const ORGANISATEUR_ROLES = ['client_organisateur'] as const;

// Pas de section « Mon organisation » au CDC pour le client organisateur : ajoutée
// par décision Val 2026-09-28 (informations légales modifiables par tous les rôles).
export default async function MonOrganisationOrganisateurPage() {
  await requirePageSession(ORGANISATEUR_ROLES);

  return (
    <div className="space-y-6">
      <Heading level={1} tone="primary">
        Mon organisation
      </Heading>
      <InfosLegalesOrganisation urlProfil="/api/v1/organisateur/mon-organisation/profil" />
    </div>
  );
}
