import { lirePagination } from '@/lib/pagination.js';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError, withApiTrace } from '@/lib/api-helpers.js';
import {
  appliquerFiltresCollectesAdmin,
  lireFiltresCollectesAdmin,
} from '@/lib/collectes-admin.js';
import { validerChampsTexteLibre } from '@/lib/champs-texte-libre.js';
import { lireTri } from '@/lib/tri-liste.js';
import { refusHeureCollecte } from '@/lib/heure-collecte.js';

// Colonnes triables de la liste (paramètre `tri`) → colonnes SQL.
const TRIS = {
  date: ['date_collecte', 'heure_collecte'],
  type: ['type', 'date_collecte'],
  statut: ['statut', 'date_collecte'],
  statut_tms: ['statut_tms', 'date_collecte'],
} satisfies Record<string, string[]>;

async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  // Filtres de la liste : lus et appliqués par le module partagé avec l'export
  // CSV (§12 §2), pour que le fichier porte exactement les lignes de la liste.
  const filtres = lireFiltresCollectesAdmin(searchParams);
  const { page, limit, from: offset } = lirePagination(searchParams);
  // Tri de la Data Table (colonnes triables) — liste blanche : la valeur part
  // dans `.order()`. Côté serveur car la liste est paginée : trier la seule
  // page chargée donnerait un ordre faux sur l'ensemble. Défaut inchangé
  // (date décroissante) ; `id` départage les ex æquo pour que deux pages
  // successives ne réordonnent pas une même ligne.
  const tri = lireTri(searchParams, TRIS, { tri: 'date', ascendant: false });

  // Embed rapports_rse : inner + filtrable quand on filtre « rapport non consulté »
  // (sinon left embed pour l'indicateur d'icône rapport de la liste).
  const rapportEmbed = filtres.rapportNonConsulte
    ? 'rapports_rse!collecte_id!inner(disponible_a, genere_at, regenere_at, consulte_par_user_at, version)'
    : 'rapports_rse!collecte_id(disponible_a, genere_at, regenere_at, consulte_par_user_at, version)';

  let query = supabase.from('collectes').select(
    `id, type, statut, statut_tms, dirty_tms, date_collecte, heure_collecte,
       nb_camions_demande, tms_reference, prestataire_logistique_id, created_at,
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
  );
  for (const c of tri.colonnes)
    query = query.order(c, { ascending: tri.ascendant });
  query = query.order('id', { ascending: tri.ascendant });

  query = appliquerFiltresCollectesAdmin(query, filtres, new Date());

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return serverError(error, 'admin.collectes.list');

  // Enrichissement carte (§06.06 §3) — champs non embeddables proprement, résolus
  // ici par requêtes batch (jamais 1 par ligne).
  type Row = {
    type?: string;
    attributions_antgaspi?: { transporteurs?: { nom?: string } | null } | null;
    collecte_tournees?: {
      tournees?: { prestataire_logistique_id?: string | null } | null;
    }[];
    packs_antgaspi?: { prix_unitaire_ht?: number | null } | null;
    factures_collectes?: { montant_ht?: number | null }[];
    evenements?: { organisation_id?: string | null };
    transporteur_nom?: string | null;
    montant_ht?: number | null;
  };
  const rows = (data ?? []) as Row[];

  // (1) Transporteur — AG : via l'attribution (embed) ; ZD / dispatchée : via la
  // tournée → shared.prestataires (cross-schema → 1 requête batch, ce repo
  // n'embed jamais shared.*).
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

  // (2) Montant AG « prix du pack ramené à la collecte » (décision Val 2026-07-04)
  // = prix_unitaire_ht du PACK ACTIF de l'organisation (invariant : au plus 1
  // actif/org). Pas de lien fiable collecte→pack (`pack_antgaspi_id` souvent null)
  // → batch par organisation. Fallback prix = montant_total_ht / credits_initiaux.
  const orgIdsAg = new Set<string>();
  for (const r of rows) {
    const org = r.evenements?.organisation_id;
    if (r.type === 'anti_gaspi' && org) orgIdsAg.add(org);
  }
  const prixPackParOrg = new Map<string, number>();
  if (orgIdsAg.size > 0) {
    const { data: packs } = await supabase
      .from('packs_antgaspi')
      .select(
        'organisation_id, prix_unitaire_ht, montant_total_ht, credits_initiaux',
      )
      .eq('statut', 'actif')
      .in('organisation_id', [...orgIdsAg]);
    for (const p of (packs ?? []) as {
      organisation_id: string;
      prix_unitaire_ht: number | null;
      montant_total_ht: number | null;
      credits_initiaux: number | null;
    }[]) {
      const prix =
        p.prix_unitaire_ht ??
        (p.montant_total_ht != null && p.credits_initiaux
          ? p.montant_total_ht / p.credits_initiaux
          : null);
      if (prix != null) prixPackParOrg.set(p.organisation_id, prix);
    }
  }

  for (const r of rows) {
    // Transporteur
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

    // Montant : ZD = facture ; AG = pack actif de l'org.
    if (r.type === 'anti_gaspi') {
      const org = r.evenements?.organisation_id;
      r.montant_ht =
        (org ? prixPackParOrg.get(org) : undefined) ??
        r.packs_antgaspi?.prix_unitaire_ht ??
        null;
    } else {
      r.montant_ht =
        r.factures_collectes?.find((f) => f.montant_ht != null)?.montant_ht ??
        null;
    }
  }

  return NextResponse.json({ data: rows, total: count ?? 0, page, limit });
}

async function postHandler(req: NextRequest): Promise<NextResponse> {
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
  const refusHeure = refusHeureCollecte(heure_collecte);
  if (refusHeure) return refusHeure;

  // Borne d'entrée du texte libre transmis au transporteur : `fn_creer_collecte`
  // stocke `p_info_suppl` tel quel, sans rien vérifier.
  const texteValide = validerChampsTexteLibre(body);
  if ('error' in texteValide) return texteValide.error;

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
      p_info_suppl: texteValide.valeurs.informations_supplementaires ?? null,
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

export const GET = withApiTrace(getHandler);
export const POST = withApiTrace(postHandler);
