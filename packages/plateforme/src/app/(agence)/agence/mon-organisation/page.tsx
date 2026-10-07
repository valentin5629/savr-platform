import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FacturesAgenceTable } from './factures-table';
import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card';
import { PageHeader } from '@/components/ui/page-header';

const AGENCE_ROLES = ['agence'] as const;

// §06.11 diff #8 — pas de sous-section « Utilisateurs » (gestion users agence =
// Admin only, RLS users self-only). Infos légales modifiables (décision Val
// 2026-09-28, route /api/v1/agence/mon-organisation/profil — lecture filtrée sur
// l'organisation du JWT : la RLS rend aussi les fiches shadow de l'agence, un
// SELECT non filtré renvoyait plusieurs lignes et la page s'affichait vide).
// Facturation en lecture seule, chargée et filtrée côté client
// (`FacturesAgenceTable`, route /api/v1/agence/factures — R-UI-4b D10).
export default async function MonOrganisationAgencePage() {
  await requirePageSession(AGENCE_ROLES);

  return (
    <div className="space-y-6">
      <PageHeader title="Mon organisation" />

      <InfosLegalesOrganisation urlProfil="/api/v1/agence/mon-organisation/profil" />

      <Card>
        <CardHeader>
          <CardTitle>Facturation</CardTitle>
        </CardHeader>
        <CardContent>
          <FacturesAgenceTable />
        </CardContent>
      </Card>
    </div>
  );
}
