// POST /api/v1/traiteur/rapports-rse/export-zip
// ZIP groupé des rapports de recyclage RSE d'une SÉLECTION de collectes traiteur
// (CDC §12 §1.2 + §06.04 l.903 « export groupé de rapports de recyclage en ZIP,
// plafond 50 fichiers / export »). BL-P3-06.
//
// Réplique le pattern registre/export-zip (createStoreZip, plafond 50, buffer) mais
// pour les rapports RSE traiteur : la source est rapports_rse.pdf_url (ZD + AG
// realisee_sans_collecte) ou attestations_don.pdf_url (AG cloturee), avec embargo
// H+24 respecté (comme la route de download unitaire). Cloisonnement : on ne retient
// que les collectes VISIBLES par le traiteur (client RLS), puis lecture service-role
// des rapports (même check-then-read que le download).

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { getObjectBytes } from '@/lib/pdf/r2-client.js';
import { createStoreZip, type ZipEntry } from '@/lib/registre/zip.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

const ZIP_MAX = 50; // §06.04 l.903 (borne alignée sur le ZIP registre).

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  tms_reference: string | null;
}

/**
 * Résout la clé R2 du rapport RSE d'une collecte + l'état d'embargo, selon la même
 * logique que la route de download unitaire (attestation AG clôturée ; rapports_rse
 * pour ZD et AG sans-excédent). Renvoie null si aucun rapport / pas de PDF.
 */
async function resolveRapportKey(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  c: CollecteRow,
): Promise<{ key: string; embargoed: boolean } | null> {
  const servirAttestation =
    c.type === 'anti_gaspi' && c.statut !== 'realisee_sans_collecte';

  if (servirAttestation) {
    const { data: att } = await admin
      .from('attestations_don')
      .select('eligible_at, pdf_url')
      .eq('collecte_id', c.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const key = (att?.pdf_url as string | null) ?? null;
    if (!att || !key) return null;
    const embargoed =
      Date.now() < new Date(att.eligible_at as string).getTime();
    return { key, embargoed };
  }

  const { data: rap } = await admin
    .from('rapports_rse')
    .select('disponible_a, genere_at, pdf_url')
    .eq('collecte_id', c.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const key = (rap?.pdf_url as string | null) ?? null;
  if (!rap || !rap.genere_at || !key) return null;
  const embargoed = Date.now() < new Date(rap.disponible_a as string).getTime();
  return { key, embargoed };
}

function entryName(c: CollecteRow, i: number): string {
  const ref =
    c.tms_reference?.trim() || c.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const d = c.date_collecte ? `${c.date_collecte}-` : '';
  // Préfixe d'index → noms uniques dans l'archive même si deux collectes partagent
  // la même référence courte.
  return `rapport-rse-${String(i + 1).padStart(2, '0')}-${d}${ref}.pdf`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const ids = Array.isArray(body['collecte_ids'])
    ? (body['collecte_ids'] as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: 'Aucune collecte sélectionnée' },
      { status: 422 },
    );
  }
  if (ids.length > ZIP_MAX) {
    return NextResponse.json(
      {
        error: `Trop de collectes sélectionnées (${ids.length}) — max ${ZIP_MAX} par export.`,
      },
      { status: 422 },
    );
  }

  try {
    // Cloisonnement : ne garder que les collectes VISIBLES par le traiteur (RLS).
    const rls = createSupabaseServerClient();
    const { data: visibles, error } = await rls
      .from('collectes')
      .select('id, type, statut, date_collecte, tms_reference')
      .in('id', ids);
    if (error) throw new Error(error.message);
    const collectes = (visibles ?? []) as CollecteRow[];
    if (collectes.length === 0) {
      return NextResponse.json(
        { error: 'Aucun rapport accessible pour la sélection' },
        { status: 422 },
      );
    }

    // Lecture service-role des rapports APRÈS le filtre RLS ci-dessus.
    const admin = createAdminSupabaseClient();
    const entries: ZipEntry[] = [];
    let embargoed = 0;
    let missing = 0;
    for (let i = 0; i < collectes.length; i++) {
      const c = collectes[i]!;
      const resolved = await resolveRapportKey(admin, c);
      if (!resolved) {
        missing++;
        continue;
      }
      if (resolved.embargoed) {
        embargoed++;
        continue;
      }
      const bytes = await getObjectBytes(resolved.key);
      entries.push({ name: entryName(c, i), data: bytes });
    }

    if (entries.length === 0) {
      return NextResponse.json(
        {
          error:
            'Aucun rapport disponible dans la sélection (embargo H+24 ou non encore généré).',
          embargoed,
          missing,
        },
        { status: 422 },
      );
    }

    const zip = createStoreZip(entries);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="rapports-rse-savr-${stamp}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Erreur export ZIP';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
