import { NextRequest, NextResponse } from 'next/server';
import { csvFilename } from '@savr/shared/src/csv/index.js';
import {
  createAdminSupabaseClient,
  type SupabaseClient,
} from '@savr/shared/src/supabase-client.js';
import { requireAnyUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { csvResponse } from '@/lib/csv.js';
import {
  EXPORT_BUILDERS,
  EXPORT_MATRIX,
  isExportEntity,
  type ExportContext,
} from '@/lib/exports/index.js';

// GET /api/v1/exports/[entity] — export tabulaire CSV (transverse D, §12 §2).
// Une seule route paramétrée : authentifie (staff OU client), applique la
// matrice d'autorisation par entité, puis le cloisonnement repose sur la RLS
// (client = JWT demandeur) ou le périmètre global (staff = service_role, pattern
// back-office). Format canonique Savr garanti par le helper @savr/shared/src/csv.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
): Promise<NextResponse> {
  const { entity } = await params;

  if (!isExportEntity(entity)) {
    return NextResponse.json(
      { error: `Entité d'export inconnue : ${entity}` },
      { status: 404 },
    );
  }

  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;

  // Matrice d'autorisation par entité (§12 §2) — gate applicatif au-dessus de la RLS.
  if (!EXPORT_MATRIX[entity].includes(auth.ctx.role)) {
    return NextResponse.json(
      { error: 'Export non autorisé pour ce profil' },
      { status: 403 },
    );
  }

  // Client de données : staff → service_role (périmètre global, pattern admin
  // back-office) ; client → RLS-scopé sur le JWT (cloisonnement multi-org).
  const supabase = (auth.ctx.isStaff
    ? createAdminSupabaseClient()
    : createSupabaseServerClient()) as unknown as SupabaseClient;

  const ctx: ExportContext = {
    supabase,
    role: auth.ctx.role,
    isStaff: auth.ctx.isStaff,
  };

  try {
    const sp = new URL(req.url).searchParams;
    const { filenamePrefix, csv } = await EXPORT_BUILDERS[entity](ctx, sp);
    return csvResponse(csvFilename(filenamePrefix, new Date()), csv);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur export';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
