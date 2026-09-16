import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

/**
 * Référentiel des prestataires logistiques, pour le choix du lien dans la fiche
 * transporteur. Lecture seule : aucun écran ne crée de prestataire en V1.
 *
 * Chaque prestataire porte le transporteur auquel il est déjà rattaché : un
 * prestataire n'en admet qu'un (`uniq_transporteur_par_prestataire`, #323), et
 * l'écran grise ce choix plutôt que de laisser l'enregistrement échouer.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();

  // shared.prestataires est cross-schema : pas d'embed PostgREST possible depuis
  // plateforme.transporteurs → deux lectures, jointes ici.
  const { data: prestataires, error } = await supabase
    .schema('shared')
    .from('prestataires')
    .select('id, nom, code, statut')
    .order('nom');
  if (error) return serverError(error, 'admin.prestataires.list');

  const { data: liens, error: liensError } = await supabase
    .from('transporteurs')
    .select('id, nom, prestataire_logistique_id')
    .not('prestataire_logistique_id', 'is', null);
  if (liensError) return serverError(liensError, 'admin.prestataires.liens');

  const transporteurParPrestataire = new Map(
    (
      (liens ?? []) as Array<{
        id: string;
        nom: string;
        prestataire_logistique_id: string;
      }>
    ).map((t) => [t.prestataire_logistique_id, t]),
  );

  return NextResponse.json({
    data: (
      (prestataires ?? []) as Array<{
        id: string;
        nom: string;
        code: string;
        statut: string;
      }>
    ).map((p) => {
      const transporteur = transporteurParPrestataire.get(p.id);
      return {
        ...p,
        transporteur_id: transporteur?.id ?? null,
        transporteur_nom: transporteur?.nom ?? null,
      };
    }),
  });
}
