// GET /api/v1/registre/export-zip — ZIP des bordereaux PDF de la période filtrée.
// Plafond 50 fichiers (décision 2026-05-29) ; ZIP vide refusé. Trace bordereaux_batch.

import { NextRequest, NextResponse } from 'next/server';

import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { getObjectBytes } from '@/lib/pdf/r2-client.js';
import { requireRegistreUser } from '@/lib/registre/guard.js';
import {
  parseRegistreFilters,
  fetchRegistre,
} from '@/lib/registre/registre.js';
import { traceExport } from '@/lib/registre/trace.js';
import { createStoreZip, type ZipEntry } from '@/lib/registre/zip.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ZIP_MAX = 50;

interface BordereauPdf {
  numero: string | null;
  fichiers: { url?: string } | { url?: string }[] | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireRegistreUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;
  const filters = parseRegistreFilters(new URL(req.url).searchParams);

  try {
    // Lignes filtrées → collectes concernées (la vue applique le périmètre RLS).
    const { rows } = await fetchRegistre(supabase, filters, { all: true });
    const collecteIds = rows.map((r) => r.collecte_id);
    if (collecteIds.length === 0) {
      return NextResponse.json(
        { error: 'Aucun bordereau sur la période' },
        { status: 422 },
      );
    }

    // Bordereaux disponibles (emis/corrige) de ces collectes (RLS-scopé).
    const { data, error } = await supabase
      .from('bordereaux_savr')
      .select('numero, fichiers:pdf_fichier_id(url)')
      .in('collecte_id', collecteIds)
      .in('statut', ['emis', 'corrige']);
    if (error) throw new Error(error.message);

    const bordereaux = (data ?? []) as unknown as BordereauPdf[];
    if (bordereaux.length === 0) {
      return NextResponse.json(
        { error: 'Aucun bordereau sur la période' },
        { status: 422 },
      );
    }
    if (bordereaux.length > ZIP_MAX) {
      return NextResponse.json(
        {
          error: `Trop de bordereaux (${bordereaux.length}) — restreignez la période (max ${ZIP_MAX}).`,
        },
        { status: 422 },
      );
    }

    const entries: ZipEntry[] = [];
    for (const b of bordereaux) {
      const f = Array.isArray(b.fichiers) ? b.fichiers[0] : b.fichiers;
      if (!f?.url) continue;
      const bytes = await getObjectBytes(f.url);
      entries.push({ name: `${b.numero ?? 'bordereau'}.pdf`, data: bytes });
    }

    const zip = createStoreZip(entries);

    await traceExport(supabase, {
      userId: auth.ctx.userId,
      organisationId: auth.ctx.organisationId,
      isStaff: auth.ctx.isStaff,
      typeExport: 'bordereaux_batch',
      format: 'zip',
      nbLignes: entries.length,
      filters,
      dates: rows.map((r) => r.date_evenement),
      now: new Date(),
    });

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="bordereaux-savr-${stamp}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur export ZIP';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
