// GET /api/v1/traiteur/collectes/:id/rapport-rse/download
// Rapport de recyclage ZD (RSE) téléchargeable depuis la fiche collecte traiteur
// (CDC §06.04 l.403 « Télécharger le rapport RSE — si rapport disponible >= H+24 »).
// Miroir de la route admin (rapports-rse/[id]/download) mais keyée par COLLECTE et
// RLS-scopée : on confirme d'abord la visibilité de la collecte (cloisonnement org
// via le client RLS), puis on lit le rapport et on renvoie une URL pré-signée R2.
// Régénération = Admin uniquement (§06.04 l.415) — non exposée ici.
// BL-P1-TRAIT-03.

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { getPresignedUrl } from '@/lib/pdf/r2-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;

  // Cloisonnement : la collecte doit être visible (RLS) par le traiteur.
  const rls = createSupabaseServerClient();
  const { data: collecte } = await rls
    .from('collectes')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  // Rapport le plus récent pour la collecte (lecture service-role après contrôle
  // d'appartenance ci-dessus — évite une dépendance à une policy RLS dédiée).
  const admin = createAdminSupabaseClient();
  const { data: rapport } = await admin
    .from('rapports_rse')
    .select('id, disponible_a, genere_at, pdf_url')
    .eq('collecte_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rapport) {
    return NextResponse.json({ error: 'Rapport introuvable' }, { status: 404 });
  }

  // Embargo applicatif H+24 (R-PDF2) — jamais contournable.
  if (Date.now() < new Date(rapport.disponible_a as string).getTime()) {
    return NextResponse.json(
      {
        error: 'Rapport sous embargo H+24',
        disponible_a: rapport.disponible_a,
      },
      { status: 425 },
    );
  }
  if (!rapport.genere_at) {
    return NextResponse.json(
      { error: 'PDF non encore généré' },
      { status: 202 },
    );
  }
  const storageKey = rapport.pdf_url as string | null;
  if (!storageKey) {
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });
  }

  const url = await getPresignedUrl(storageKey, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
