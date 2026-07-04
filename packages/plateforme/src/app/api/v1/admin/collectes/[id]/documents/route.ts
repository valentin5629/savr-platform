// GET /api/v1/admin/collectes/[id]/documents
// Alimente le Bloc 3 « Documents » de la fiche collecte Admin (§06.06 l.246) :
// Rapport RSE, Bordereau ZD, Attestation de don (AG), + galerie photos.
// Accès : admin_savr + ops_savr (requireStaff).
//
// Requêtes explicites (pas d'embed PostgREST fragile) : le main GET /[id] reste
// intact. Les photos vivent dans shared.fichiers (polymorphe entity_type/entity_id,
// pas de FK depuis collectes → fetch dédié).

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { getPresignedUrl } from '@/lib/pdf/r2-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PhotoRow {
  id: string;
  bucket: string;
  key: string;
  content_type: string;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  // Rapport RSE (dernière version). regenere_at / version → picto ⟳ (§06.06 l.170).
  const { data: rapport } = await supabase
    .from('rapports_rse')
    .select(
      'id, version, disponible_a, genere_at, regenere_at, consulte_par_user_at, pdf_url',
    )
    .eq('collecte_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Bordereau ZD (1 par collecte, ZD only).
  const { data: bordereau } = await supabase
    .from('bordereaux_savr')
    .select('id, statut, numero, genere_at, pdf_fichier_id')
    .eq('collecte_id', id)
    .maybeSingle();

  // Attestation de don (AG, dernière version — clé (collecte_id, version)).
  const { data: attestation } = await supabase
    .from('attestations_don')
    .select(
      'id, statut, numero, genere_at, pdf_url, version, mention_fiscale_2041ge',
    )
    .eq('collecte_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Photos — shared.fichiers polymorphe (entity_type = 'plateforme.collectes').
  const { data: photosRaw } = await supabase
    .schema('shared')
    .from('fichiers')
    .select('id, bucket, key, content_type, created_at')
    .eq('entity_type', 'plateforme.collectes')
    .eq('entity_id', id)
    .is('deleted_at', null)
    .like('content_type', 'image/%')
    .order('created_at', { ascending: false });

  // URL d'affichage pré-signée (best-effort : R2 non configuré en local → url null,
  // la galerie affiche le fichier sans lien plutôt que de faire échouer le GET).
  const photos = await Promise.all(
    ((photosRaw ?? []) as PhotoRow[]).map(async (p) => {
      let url: string | null = null;
      try {
        url = await getPresignedUrl(`${p.bucket}/${p.key}`, 900);
      } catch {
        url = null;
      }
      return {
        id: p.id,
        content_type: p.content_type,
        created_at: p.created_at,
        url,
      };
    }),
  );

  return NextResponse.json({
    rapport: rapport ?? null,
    bordereau: bordereau ?? null,
    attestation: attestation ?? null,
    photos,
  });
}
