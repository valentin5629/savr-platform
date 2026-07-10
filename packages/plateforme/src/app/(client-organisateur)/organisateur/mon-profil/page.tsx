import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SecuriteAccesPanel } from '@/components/compte/securite-acces-panel';

const ORGANISATEUR_ROLES = ['client_organisateur'] as const;

// BL-P3-13 — « Sécurité du compte » pour le client organisateur (rôle impersonable,
// CDC §15 §2.3). Ce rôle n'avait pas de page profil : on en crée une minimale
// portant l'historique self des accès admin.
export default async function MonProfilOrganisateurPage() {
  const session = await requirePageSession(ORGANISATEUR_ROLES);

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

      <SecuriteAccesPanel />
    </div>
  );
}
