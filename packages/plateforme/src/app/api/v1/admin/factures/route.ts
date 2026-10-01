import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';
import { lireTri } from '@/lib/tri-liste.js';
import { estUuid, listeCsv, parmi } from '@/lib/filtre-csv.js';
import { Constants } from '@savr/shared/src/database.types.js';

async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const url = new URL(req.url);
  const statut = url.searchParams.get('statut');
  // R22b BL-P2-02 — filtres liste (§06.08 §4/§8) : type, période, « en erreur ».
  // Organisation et Type à choix multiple ; `organisation_id` reste lu (fiche
  // Client, onglet Factures).
  const orgIds = listeCsv(
    url.searchParams.get('organisation_ids') ??
      url.searchParams.get('organisation_id'),
    estUuid,
  );
  const types = listeCsv(
    url.searchParams.get('types') ?? url.searchParams.get('type'),
    parmi(Constants.plateforme.Enums.facture_type),
  );
  const dateDebut = url.searchParams.get('date_debut');
  const dateFin = url.searchParams.get('date_fin');
  const enErreur = url.searchParams.get('en_erreur');
  // C3 : borner page ≥ 1 (un page=0/négatif/NaN donnait un offset négatif → 500).
  const page = Math.max(
    1,
    parseInt(url.searchParams.get('page') ?? '1', 10) || 1,
  );
  const limit = 50;
  const offset = (page - 1) * limit;
  const tri = lireTri(
    url.searchParams,
    {
      numero_facture: ['numero_facture'],
      type: ['type'],
      montant_ht: ['montant_ht'],
      montant_ttc: ['montant_ttc'],
      created_at: ['created_at'],
      date_emission: ['date_emission'],
      statut: ['statut'],
    },
    { tri: 'created_at', ascendant: false },
  );

  let query = supabase.from('factures').select(
    `id, numero_facture, type, mode_facturation, statut, pennylane_statut,
       montant_ht, taux_tva, montant_ttc, devise,
       date_emission, date_echeance, date_paiement,
       organisation_id, entite_facturation_id, pack_antgaspi_id,
       pennylane_id, pdf_url_pennylane, pdf_url_savr,
       erreur_synchro, erreur_synchro_at, derniere_tentative_pennylane_at,
       created_at, updated_at,
       organisations!organisation_id(raison_sociale),
       entites_facturation(raison_sociale, siret),
       factures_collectes(count)`,
    { count: 'exact' },
  );
  // Tri de la Data Table (liste blanche, cf. lib/tri-liste) ; `id` départage
  // les ex æquo pour qu'une ligne ne saute pas d'une page à l'autre.
  for (const c of tri.colonnes)
    query = query.order(c, { ascending: tri.ascendant });
  query = query
    .order('id', { ascending: tri.ascendant })
    .range(offset, offset + limit - 1);

  if (statut) query = query.eq('statut', statut);
  if (orgIds.length > 0) query = query.in('organisation_id', orgIds);
  if (types.length > 0) query = query.in('type', types);
  // « En erreur » (§06.08 §2.3) — factures portant une erreur de synchro Pennylane
  // (rejet 4xx repassé en brouillon, ou retry épuisé echec_final).
  if (enErreur === '1') query = query.not('erreur_synchro', 'is', null);
  // Période sur created_at (= « Créée le » du tableau §06.08 §4, toujours renseignée,
  // contrairement à date_emission qui est NULL en brouillon). date_fin inclusive.
  if (dateDebut) query = query.gte('created_at', dateDebut);
  if (dateFin) query = query.lte('created_at', `${dateFin}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) return serverError(error, 'admin.factures.list');

  return NextResponse.json({ data, total: count, page, limit });
}

export const GET = withApiTrace(getHandler);
