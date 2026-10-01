import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { listeCsv, parmi } from '@/lib/filtre-csv.js';
import { Constants } from '@savr/shared/src/database.types.js';

// Lecture seule, manager + commercial (§06.04 §6 Facturation, révision 2026-05-29).
const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// GET /api/v1/traiteur/factures — liste des factures de l'orga (lecture seule).
// La policy fac_client_select + masquage colonne F5 (M3.5) garantissent le
// périmètre org-scoped et l'exclusion des colonnes sensibles (marge, synchro).
// Les brouillons sont exclus (non visibles côté traiteur — §06.04 fiche).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  // Statut et Type à choix multiple. Le périmètre reste celui de la RLS et le
  // `.neq('statut', 'brouillon')` ci-dessous : `.in()` ne fait que restreindre.
  const statuts = listeCsv(
    searchParams.get('statuts') ?? searchParams.get('statut'),
    parmi(Constants.plateforme.Enums.facture_statut),
  );
  const types = listeCsv(
    searchParams.get('types') ?? searchParams.get('type'),
    parmi(Constants.plateforme.Enums.facture_type),
  );
  // Filtres §06.04 §6 l.690 : statut, type, période (date d'émission).
  const dateDebut = searchParams.get('date_debut');
  const dateFin = searchParams.get('date_fin');

  let query = supabase
    .from('factures')
    .select(
      `id, numero_facture, type, statut, montant_ht, montant_ttc,
       date_emission, date_echeance, date_paiement, pdf_url_pennylane, pdf_url_savr`,
    )
    .neq('statut', 'brouillon')
    .order('date_emission', { ascending: false, nullsFirst: false });

  if (statuts.length > 0) query = query.in('statut', statuts);
  if (types.length > 0) query = query.in('type', types);
  if (dateDebut) query = query.gte('date_emission', dateDebut);
  if (dateFin) query = query.lte('date_emission', dateFin);

  const { data, error } = await query;
  if (error) return serverError(error, 'traiteur.factures.list');
  return NextResponse.json({ data });
}
