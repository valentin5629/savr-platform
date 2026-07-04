import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError } from '@/lib/api-helpers.js';
import {
  applyChipPredicate,
  isChipKey,
  type ChipQuery,
} from '@/lib/collectes-chips.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const statut = searchParams.get('statut');
  const statuts = searchParams.get('statuts'); // multi-sélection (CSV) §06.06 §3
  const type = searchParams.get('type');
  const statut_tms = searchParams.get('statut_tms');
  const chip = searchParams.get('chip');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const organisation_id = searchParams.get('organisation_id'); // traiteur (autocomplete)
  const lieu_id = searchParams.get('lieu_id'); // lieu (autocomplete)
  const info_incomplete = searchParams.get('info_incomplete'); // « Info incomplète »
  const rapport_non_consulte = searchParams.get('rapport_non_consulte'); // rapport non consulté
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  // Embed rapports_rse : inner + filtrable quand on filtre « rapport non consulté »
  // (sinon left embed pour l'indicateur d'icône rapport de la liste).
  const rapportEmbed =
    rapport_non_consulte === 'true'
      ? 'rapports_rse!collecte_id!inner(disponible_a, genere_at, regenere_at, consulte_par_user_at, version)'
      : 'rapports_rse!collecte_id(disponible_a, genere_at, regenere_at, consulte_par_user_at, version)';

  let query = supabase
    .from('collectes')
    .select(
      `id, type, statut, statut_tms, dirty_tms, date_collecte, heure_collecte,
       nb_camions_demande, tms_reference, created_at,
       controle_acces_requis, informations_completes, taux_recyclage,
       attributions_antgaspi!collecte_id(id, valide_at, mode_validation, volume_repas_realise, transporteurs!transporteur_id(nom)),
       packs_antgaspi!pack_antgaspi_id(prix_unitaire_ht),
       factures_collectes(montant_ht),
       collecte_tournees(tournees(prestataire_logistique_id)),
       collecte_flux(poids_reel_kg),
       ${rapportEmbed},
       evenements!inner(
         organisation_id, lieu_id, nom_evenement, pax, nom_client_organisateur,
         organisations!organisation_id(raison_sociale),
         client_organisateur:organisations!client_organisateur_organisation_id(raison_sociale),
         lieux!lieu_id(nom, adresse_acces, code_postal, ville)
       )`,
      { count: 'exact' },
    )
    .order('date_collecte', { ascending: false });

  // Chips prédéfinis (§06.06 §3) — prédicats partagés avec /chip-counts.
  if (chip && isChipKey(chip)) {
    // Cast via `unknown` : le builder PostgREST est structurellement compatible
    // avec ChipQuery mais la comparaison profonde déclenche TS2589.
    query = applyChipPredicate(
      query as unknown as ChipQuery,
      chip,
      new Date(),
    ) as unknown as typeof query;
  } else {
    // Statut : multi-sélection (`statuts` CSV) prioritaire, sinon mono (`statut`).
    if (statuts) {
      const list = statuts
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length > 0) query = query.in('statut', list);
    } else if (statut) {
      query = query.eq('statut', statut);
    }
    if (type) query = query.eq('type', type);
    if (statut_tms) query = query.eq('statut_tms', statut_tms);
    if (from) query = query.gte('date_collecte', from);
    if (to) query = query.lte('date_collecte', to);
    if (organisation_id)
      query = query.eq('evenements.organisation_id', organisation_id);
    if (lieu_id) query = query.eq('evenements.lieu_id', lieu_id);
    if (info_incomplete === 'true')
      query = query.eq('informations_completes', false);
    if (rapport_non_consulte === 'true')
      query = query.is('rapports_rse.consulte_par_user_at', null);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return serverError(error, 'admin.collectes.list');

  // Nom du transporteur (ligne 2 de la carte, §06.06 §3) — AG : via l'attribution
  // (embed) ; ZD / dispatchée : via la tournée → shared.prestataires. Ce repo
  // n'embed jamais shared.* en cross-schema → 1 requête batch (pas 1 par ligne).
  type Row = {
    attributions_antgaspi?: { transporteurs?: { nom?: string } | null } | null;
    collecte_tournees?: {
      tournees?: { prestataire_logistique_id?: string | null } | null;
    }[];
    transporteur_nom?: string | null;
  };
  const rows = (data ?? []) as Row[];
  const prestaIds = new Set<string>();
  for (const r of rows) {
    for (const ct of r.collecte_tournees ?? []) {
      const pid = ct.tournees?.prestataire_logistique_id;
      if (pid) prestaIds.add(pid);
    }
  }
  const prestaNoms = new Map<string, string>();
  if (prestaIds.size > 0) {
    const { data: prestas } = await supabase
      .schema('shared')
      .from('prestataires')
      .select('id, nom')
      .in('id', [...prestaIds]);
    for (const p of (prestas ?? []) as { id: string; nom: string }[]) {
      prestaNoms.set(p.id, p.nom);
    }
  }
  for (const r of rows) {
    let nom = r.attributions_antgaspi?.transporteurs?.nom ?? null;
    if (!nom) {
      for (const ct of r.collecte_tournees ?? []) {
        const pid = ct.tournees?.prestataire_logistique_id;
        if (pid && prestaNoms.has(pid)) {
          nom = prestaNoms.get(pid) ?? null;
          break;
        }
      }
    }
    r.transporteur_nom = nom;
  }

  return NextResponse.json({ data: rows, total: count ?? 0 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const parsed = await readJsonBody(req);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data;
  const { evenement_id, type, date_collecte, heure_collecte } = body;

  if (!evenement_id || !type || !date_collecte || !heure_collecte) {
    return NextResponse.json(
      {
        error:
          'Champs obligatoires : evenement_id, type, date_collecte, heure_collecte',
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // fn_creer_collecte : INSERT collecte + outbox E1 dans la même transaction (G4)
  const { data: collecteId, error: rpcError } = await supabase.rpc(
    'fn_creer_collecte',
    {
      p_evenement_id: evenement_id,
      p_type: type,
      p_date_collecte: date_collecte,
      p_heure_collecte: heure_collecte,
      p_nb_camions: body.nb_camions_demande ?? 1,
      p_controle_acces: body.controle_acces_requis ?? false,
      p_notes: body.notes_internes ?? null,
      p_info_suppl: body.informations_supplementaires ?? null,
    },
  );

  if (rpcError) return serverError(rpcError, 'admin.collectes.create');

  const newId = collecteId as string;

  // NB : pas de pré-création de lignes collecte_flux ici. Les pesées ZD sont
  // DÉRIVÉES de pesees_tournees par fn_agreger_terminal_collecte à l'agrégation
  // terminale (UPSERT par flux — §04 Data Model « collecte_flux dérivée »), ou
  // saisies manuellement par l'Admin via PATCH /admin/collectes/[id]/flux (UPSERT).
  // Pré-créer 5 lignes à poids NULL ferait passer le gate batch PDF « 0 ligne →
  // skip » (R-PDF3/R9, batch-pdf-j1.ts) et produirait des bordereaux vides.

  // Retourner la collecte créée
  const { data, error } = await supabase
    .from('collectes')
    .select()
    .eq('id', newId)
    .single();

  if (error) return serverError(error, 'admin.collectes.create_fetch');

  return NextResponse.json(data, { status: 201 });
}
