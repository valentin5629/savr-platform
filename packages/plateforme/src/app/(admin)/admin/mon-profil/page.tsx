import { requireStaffPage } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChangerMotDePassePanel } from '@/components/compte/changer-mot-de-passe-panel';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';

// « Mon profil » staff (§06.04 §7 : section commune à tous les users). Le
// back-office n'en avait pas : ajouté par décision Val 2026-09-28 (chaque
// utilisateur modifie ses informations, quel que soit son rôle).
export default async function MonProfilAdminPage() {
  const session = await requireStaffPage();

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

      <ChangerMotDePassePanel />

      <RgpdComptePanel />
    </div>
  );
}
