// GET /api/v1/registre/export-csv — export CSV du registre filtré (§06.03).
// Toutes les lignes filtrées (pas de pagination) + trace exports_registre.

import { NextRequest, NextResponse } from 'next/server';

import { csvFilename } from '@savr/shared/src/csv/index.js';
import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { csvResponse } from '@/lib/csv.js';
import { requireRegistreUser } from '@/lib/registre/guard.js';
import {
  parseRegistreFilters,
  fetchRegistre,
} from '@/lib/registre/registre.js';
import { fetchFluxDetail, buildRegistreCsv } from '@/lib/registre/csv.js';
import { traceExport } from '@/lib/registre/trace.js';
import { serverError } from '@/lib/api-helpers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireRegistreUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;
  const filters = parseRegistreFilters(new URL(req.url).searchParams);

  try {
    const { rows } = await fetchRegistre(supabase, filters, { all: true });
    const flux = await fetchFluxDetail(
      supabase,
      rows.map((r) => r.collecte_id),
    );
    const csv = buildRegistreCsv(rows, flux);

    await traceExport(supabase, {
      userId: auth.ctx.userId,
      organisationId: auth.ctx.organisationId,
      isStaff: auth.ctx.isStaff,
      typeExport: 'registre_dechets',
      format: 'csv',
      nbLignes: rows.length,
      filters,
      dates: rows.map((r) => r.date_evenement),
      now: new Date(),
    });

    return csvResponse(csvFilename('registre', new Date()), csv);
  } catch (e) {
    // Le message est déjà neutralisé à la source (`erreurInterne`), mais le
    // renvoyer via une variable intermédiaire rendait le cliquet aveugle à ce
    // chemin (contre-revue sécurité) : on passe par le helper, comme partout.
    return serverError(e, 'registre.export_csv');
  }
}
