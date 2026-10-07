import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';
import { ChangerMotDePassePanel } from '@/components/compte/changer-mot-de-passe-panel';
import { SecuriteAccesPanel } from '@/components/compte/securite-acces-panel';
import { PageHeader } from '@/components/ui/page-header';

const TRAITEUR_ROLES = ['traiteur_manager', 'traiteur_commercial'] as const;

export default async function MonProfilPage() {
  const session = await requirePageSession(TRAITEUR_ROLES);

  return (
    <div className="space-y-6">
      <PageHeader title="Mon profil" />

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
    </div>
  );
}
