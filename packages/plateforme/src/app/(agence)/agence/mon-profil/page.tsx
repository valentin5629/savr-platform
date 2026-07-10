import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';
import { SecuriteAccesPanel } from '@/components/compte/securite-acces-panel';

const AGENCE_ROLES = ['agence'] as const;

export default async function MonProfilAgencePage() {
  const session = await requirePageSession(AGENCE_ROLES);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">Mon profil</h1>

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

      <Card>
        <CardHeader>
          <CardTitle>Sécurité</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="secondary" asChild>
            <a href="/login">Changer mon mot de passe</a>
          </Button>
        </CardContent>
      </Card>

      <SecuriteAccesPanel />

      <RgpdComptePanel />
    </div>
  );
}
