import { requirePageSession } from '@/lib/page-auth';
import { facturationPlateformeActive } from '@/lib/facturation-plateforme';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel';
import { SecuriteAccesPanel } from '@/components/compte/securite-acces-panel';
import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card';
import {
  ParametresOnglets,
  type OngletParametres,
} from '@/components/parametres/parametres-onglets';
import { ONGLET_ORGANISATION, ONGLET_PROFIL, ROUTES } from '@/lib/routes';
import { FacturesAgenceTable } from './factures-table';

const AGENCE_ROLES = ['agence'] as const;

// « Paramètres » agence = ex « Mon organisation » + ex « Mon profil », réunis
// en onglets (décision Val 2026-10-31).
// §06.11 diff #8 — pas d'onglet « Utilisateurs » (gestion users agence = Admin
// only, RLS users self-only). Infos légales modifiables (décision Val
// 2026-09-28, route /api/v1/agence/mon-organisation/profil — lecture filtrée sur
// l'organisation du JWT : la RLS rend aussi les fiches shadow de l'agence, un
// SELECT non filtré renvoyait plusieurs lignes et la page s'affichait vide).
// Facturation en lecture seule, chargée et filtrée côté client
// (`FacturesAgenceTable`, route /api/v1/agence/factures — R-UI-4b D10).
export default async function ParametresAgencePage({
  searchParams,
}: {
  searchParams: Promise<{ onglet?: string | string[] }>;
}) {
  const session = await requirePageSession(AGENCE_ROLES);
  const { onglet } = await searchParams;

  const onglets: OngletParametres[] = [
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
          <Card>
            <CardHeader>
              <CardTitle>Sécurité</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="secondary" asChild>
                <a href={ROUTES.login}>Changer mon mot de passe</a>
              </Button>
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
        <InfosLegalesOrganisation urlProfil="/api/v1/agence/mon-organisation/profil" />
      ),
    },
    // Facturation hors plateforme au go-live (décision Val 2026-10-22).
    ...(facturationPlateformeActive()
      ? [
          {
            value: 'facturation',
            label: 'Facturation',
            contenu: (
              <Card>
                <CardHeader>
                  <CardTitle>Facturation</CardTitle>
                </CardHeader>
                <CardContent>
                  <FacturesAgenceTable />
                </CardContent>
              </Card>
            ),
          },
        ]
      : []),
  ];

  return <ParametresOnglets onglets={onglets} initial={onglet} />;
}
