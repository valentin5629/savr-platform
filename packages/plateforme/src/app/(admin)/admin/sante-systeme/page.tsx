import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const ALLOWED_ROLES = ['admin_savr', 'ops_savr'];

interface OpsOutbox {
  nb_pending: number;
  nb_processing: number;
  nb_dlq: number;
  plus_ancien_at: string | null;
}

interface OpsJobsPdf {
  nb_pending: number;
  nb_failed: number;
  max_tentatives: number | null;
  plus_ancien_at: string | null;
}

interface OpsIntegration {
  service: string;
  dernier_appel_at: string | null;
  nb_echecs_24h: number;
}

interface OpsBatch {
  job_name: string;
  dernier_run_at: string | null;
  statut: string | null;
  nb_traite: number | null;
}

interface OpsFactureBloquee {
  facture_id: string;
  numero_facture: string | null;
  statut: string;
  heures_sans_retour: number;
}

function parseJwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fetchOpsData() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: 'plateforme' },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    },
  );

  const [outbox, jobsPdf, integrations, batchs, facturesBloquees] =
    await Promise.all([
      supabase.from('v_ops_outbox').select('*').single(),
      supabase.from('v_ops_jobs_pdf').select('*').single(),
      supabase.from('v_ops_integrations').select('*'),
      supabase.from('v_ops_batchs').select('*'),
      supabase.from('v_ops_factures_bloquees').select('*'),
    ]);

  return {
    outbox: outbox.data as OpsOutbox | null,
    jobsPdf: jobsPdf.data as OpsJobsPdf | null,
    integrations: (integrations.data ?? []) as OpsIntegration[],
    batchs: (batchs.data ?? []) as OpsBatch[],
    facturesBloquees: (facturesBloquees.data ?? []) as OpsFactureBloquee[],
  };
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <Badge variant={ok ? 'success' : 'error'}>
      {label ?? (ok ? 'OK' : 'KO')}
    </Badge>
  );
}

export default async function SanteSystemePage() {
  // Guard serveur : vérifier le rôle avant tout accès service_role
  const cookieStore = await cookies();
  const authClient = createServerClient(
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

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) redirect('/login');

  const {
    data: { session },
  } = await authClient.auth.getSession();
  const claims = parseJwtClaims(session?.access_token ?? '');
  const role = claims['role'] as string | undefined;
  if (!role || !ALLOWED_ROLES.includes(role)) redirect('/403');

  const data = await fetchOpsData();

  const outboxOk = (data.outbox?.nb_dlq ?? 0) === 0;
  const jobsPdfOk = (data.jobsPdf?.nb_failed ?? 0) === 0;
  const facturesOk = data.facturesBloquees.length === 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Santé système
      </h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Outbox */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Outbox events</CardTitle>
              <StatusBadge ok={outboxOk} />
            </div>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-savr-neutral-500">En attente</span>
              <span className="font-medium">
                {data.outbox?.nb_pending ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-savr-neutral-500">En traitement</span>
              <span className="font-medium">
                {data.outbox?.nb_processing ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-savr-neutral-500">
                DLQ (échec définitif)
              </span>
              <span
                className={`font-medium ${(data.outbox?.nb_dlq ?? 0) > 0 ? 'text-savr-error' : ''}`}
              >
                {data.outbox?.nb_dlq ?? 0}
              </span>
            </div>
            {data.outbox?.plus_ancien_at && (
              <div className="flex justify-between">
                <span className="text-savr-neutral-500">Plus ancien</span>
                <span className="font-medium text-xs">
                  {new Date(data.outbox.plus_ancien_at).toLocaleString('fr-FR')}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Jobs PDF */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Jobs PDF</CardTitle>
              <StatusBadge ok={jobsPdfOk} />
            </div>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-savr-neutral-500">En attente</span>
              <span className="font-medium">
                {data.jobsPdf?.nb_pending ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-savr-neutral-500">En échec</span>
              <span
                className={`font-medium ${(data.jobsPdf?.nb_failed ?? 0) > 0 ? 'text-savr-error' : ''}`}
              >
                {data.jobsPdf?.nb_failed ?? 0}
              </span>
            </div>
            {data.jobsPdf?.max_tentatives != null && (
              <div className="flex justify-between">
                <span className="text-savr-neutral-500">Max tentatives</span>
                <span className="font-medium">
                  {data.jobsPdf.max_tentatives}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Factures bloquées */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Factures bloquées Pennylane
              </CardTitle>
              <StatusBadge
                ok={facturesOk}
                label={facturesOk ? 'OK' : `${data.facturesBloquees.length}`}
              />
            </div>
          </CardHeader>
          <CardContent className="text-sm">
            {data.facturesBloquees.length === 0 ? (
              <p className="text-savr-neutral-500">
                Aucune facture en attente &gt; 48h
              </p>
            ) : (
              <ul className="space-y-1">
                {data.facturesBloquees.slice(0, 5).map((f) => (
                  <li key={f.facture_id} className="flex justify-between">
                    <span className="font-mono text-xs">
                      {f.numero_facture ?? f.facture_id.slice(0, 8)}
                    </span>
                    <span className="text-savr-warning text-xs">
                      {Math.round(f.heures_sans_retour)}h sans retour
                    </span>
                  </li>
                ))}
                {data.facturesBloquees.length > 5 && (
                  <li className="text-savr-neutral-400 text-xs">
                    +{data.facturesBloquees.length - 5} autres
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Intégrations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Intégrations externes</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-savr-neutral-500">
                <th className="pb-2 font-medium">Service</th>
                <th className="pb-2 font-medium">Dernier appel</th>
                <th className="pb-2 font-medium">Échecs 24h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-savr-neutral-100">
              {data.integrations.map((i) => (
                <tr key={i.service}>
                  <td className="py-1.5 font-medium uppercase">{i.service}</td>
                  <td className="py-1.5 text-savr-neutral-500">
                    {i.dernier_appel_at
                      ? new Date(i.dernier_appel_at).toLocaleString('fr-FR')
                      : '—'}
                  </td>
                  <td className="py-1.5">
                    <span
                      className={
                        i.nb_echecs_24h > 0
                          ? 'text-savr-error font-medium'
                          : 'text-savr-neutral-500'
                      }
                    >
                      {i.nb_echecs_24h}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Batchs cron */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Batchs cron</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-savr-neutral-500">
                <th className="pb-2 font-medium">Job</th>
                <th className="pb-2 font-medium">Dernier run</th>
                <th className="pb-2 font-medium">Statut</th>
                <th className="pb-2 font-medium">Traités</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-savr-neutral-100">
              {data.batchs.map((b) => (
                <tr key={b.job_name}>
                  <td className="py-1.5 font-mono text-xs">{b.job_name}</td>
                  <td className="py-1.5 text-savr-neutral-500">
                    {b.dernier_run_at
                      ? new Date(b.dernier_run_at).toLocaleString('fr-FR')
                      : '—'}
                  </td>
                  <td className="py-1.5">
                    {b.statut ? (
                      <StatusBadge
                        ok={b.statut === 'completed'}
                        label={b.statut}
                      />
                    ) : (
                      <span className="text-savr-neutral-400 text-xs">
                        jamais exécuté
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-savr-neutral-500">
                    {b.nb_traite ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
