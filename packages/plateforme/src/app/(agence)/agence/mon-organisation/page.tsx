import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FacturesAgenceTable } from './factures-table';
import { InfosLegalesOrganisation } from '@/components/organisation/infos-legales-card';

const AGENCE_ROLES = ['agence'] as const;

async function fetchData() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    },
  );

  const { data: factures } = await supabase
    .from('factures')
    .select(
      'id, numero_facture, statut, montant_ttc, date_emission, date_echeance',
    )
    .neq('statut', 'brouillon')
    .order('date_emission', { ascending: false, nullsFirst: false })
    .limit(20);

  return { factures: factures ?? [] };
}

// §06.11 diff #8 — pas de sous-section « Utilisateurs » (gestion users agence =
// Admin only, RLS users self-only). Infos légales modifiables (décision Val
// 2026-09-28, route /api/v1/agence/mon-organisation/profil — lecture filtrée sur
// l'organisation du JWT : la RLS rend aussi les fiches shadow de l'agence, un
// SELECT non filtré renvoyait plusieurs lignes et la page s'affichait vide).
// Facturation en lecture seule.
export default async function MonOrganisationAgencePage() {
  await requirePageSession(AGENCE_ROLES);
  const { factures } = await fetchData();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Mon organisation
      </h1>

      <InfosLegalesOrganisation urlProfil="/api/v1/agence/mon-organisation/profil" />

      <Card>
        <CardHeader>
          <CardTitle>Facturation</CardTitle>
        </CardHeader>
        <CardContent>
          <FacturesAgenceTable factures={factures} />
        </CardContent>
      </Card>
    </div>
  );
}
