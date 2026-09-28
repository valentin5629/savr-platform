import { requirePageSession } from '@/lib/page-auth';
import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card';

const ORGANISATEUR_ROLES = ['client_organisateur'] as const;

// Pas de section « Mon organisation » au CDC pour le client organisateur : ajoutée
// par décision Val 2026-09-28 (informations légales modifiables par tous les rôles).
export default async function MonOrganisationOrganisateurPage() {
  await requirePageSession(ORGANISATEUR_ROLES);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Mon organisation
      </h1>
      <InfosLegalesOrganisation urlProfil="/api/v1/organisateur/mon-organisation/profil" />
    </div>
  );
}
