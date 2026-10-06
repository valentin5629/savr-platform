import { requirePageSession } from '@/lib/page-auth';
import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card';
import { PageHeader } from '@/components/ui/page-header';

const ORGANISATEUR_ROLES = ['client_organisateur'] as const;

// Pas de section « Mon organisation » au CDC pour le client organisateur : ajoutée
// par décision Val 2026-09-28 (informations légales modifiables par tous les rôles).
export default async function MonOrganisationOrganisateurPage() {
  await requirePageSession(ORGANISATEUR_ROLES);

  return (
    <div className="space-y-6">
      <PageHeader title="Mon organisation" />
      <InfosLegalesOrganisation urlProfil="/api/v1/organisateur/mon-organisation/profil" />
    </div>
  );
}
