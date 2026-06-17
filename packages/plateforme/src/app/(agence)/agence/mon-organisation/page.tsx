import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requirePageSession } from '@/lib/page-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

  const { data: org } = await supabase
    .from('organisations')
    .select(
      'id, nom, raison_sociale, siret, adresse, email_principal, logo_url',
    )
    .maybeSingle();

  const { data: factures } = await supabase
    .from('factures')
    .select(
      'id, numero_facture, statut, montant_ttc, date_emission, date_echeance',
    )
    .neq('statut', 'brouillon')
    .order('date_emission', { ascending: false, nullsFirst: false })
    .limit(20);

  return { org, factures: factures ?? [] };
}

// §06.11 diff #8 — pas de sous-section « Utilisateurs » (gestion users agence =
// Admin only, RLS users self-only). Cette page n'expose que les infos légales et
// la facturation (lecture seule).
export default async function MonOrganisationAgencePage() {
  await requirePageSession(AGENCE_ROLES);
  const { org, factures } = await fetchData();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Mon organisation
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Informations légales</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div>
            <span className="text-savr-neutral-500">Raison sociale : </span>
            {org?.raison_sociale ?? org?.nom ?? '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">SIRET : </span>
            {org?.siret ?? '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Adresse : </span>
            {org?.adresse ?? '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Email : </span>
            {org?.email_principal ?? '—'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facturation</CardTitle>
        </CardHeader>
        <CardContent>
          {factures.length === 0 ? (
            <p className="text-sm text-savr-neutral-500">Aucune facture.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-savr-neutral-500">
                <tr>
                  <th className="py-1">Numéro</th>
                  <th className="py-1">Émission</th>
                  <th className="py-1">Échéance</th>
                  <th className="py-1">Montant TTC</th>
                  <th className="py-1">Statut</th>
                </tr>
              </thead>
              <tbody>
                {factures.map((f) => (
                  <tr key={f.id} className="border-t border-savr-neutral-100">
                    <td className="py-1">{f.numero_facture ?? '—'}</td>
                    <td className="py-1">{f.date_emission ?? '—'}</td>
                    <td className="py-1">{f.date_echeance ?? '—'}</td>
                    <td className="py-1">{f.montant_ttc ?? '—'} €</td>
                    <td className="py-1">
                      <Badge variant="neutral">{f.statut}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
