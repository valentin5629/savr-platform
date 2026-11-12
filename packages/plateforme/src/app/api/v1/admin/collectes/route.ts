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
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';
import { lireCollectesEnvoiAbandonne } from '@/lib/ordre-envoi.js';
import { montantsPrestation, type PackPrix } from '@/lib/montant-prestation.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

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
    `id, type, statut, statut_tms, dirty_tms, date_collecte, heure_collecte, pax,
       nb_camions_demande, tms_reference, prestataire_logistique_id, created_at,
       controle_acces_requis, informations_completes, taux_recyclage,
       attributions_antgaspi!collecte_id(id, valide_at, mode_validation, volume_repas_realise, transporteurs!transporteur_id(nom)),
       packs_antgaspi!pack_antgaspi_id(prix_unitaire_ht, montant_total_ht, credits_initiaux),
       collecte_tournees(tournees(prestataire_logistique_id)),
       collecte_flux(poids_reel_kg),
       ${rapportEmbed},
       evenements!inner(
         organisation_id, lieu_id, nom_evenement, nom_client_organisateur,
         organisations!organisation_id(raison_sociale),
         client_organisateur:organisations!client_organisateur_organisation_id(raison_sociale),
         lieux!lieu_id(nom, adresse_acces, code_postal, ville)
       )`,
    { count: 'exact' },
  );
  for (const c of tri.colonnes)
    query = query.order(c, { ascending: tri.ascendant });
  query = query.order('id', { ascending: tri.ascendant });

  // Envoi abandonné = « Créée » (décision Val 2026-11-02) : lu dans la file
  // d'envoi, pour le filtre comme pour le libellé de chaque ligne.
  const abandons = await lireCollectesEnvoiAbandonne(supabase);
  if (abandons.error)
    return serverError(abandons.error, 'admin.collectes.list');

  // Le filtre de statut refuse une liste d'abandons que l'URL ne porterait pas
  // (`MAX_ENVOIS_ABANDONNES_FILTRE`) : rendu comme toute lecture en échec.
  try {
    query = appliquerFiltresCollectesAdmin(query, filtres, new Date(), [
      ...abandons.data,
    ]);
  } catch (e) {
    return serverError(e, 'admin.collectes.list.filtre_statut');
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) return serverError(error, 'admin.collectes.list');

  // Enrichissement carte (§06.06 §3) — champs non embeddables proprement, résolus
  // ici par requêtes batch (jamais 1 par ligne).
  type Row = {
    id?: string;
    type?: string;
    envoi_abandonne?: boolean;
    attributions_antgaspi?: { transporteurs?: { nom?: string } | null } | null;
    collecte_tournees?: {
      tournees?: { prestataire_logistique_id?: string | null } | null;
    }[];
    pax?: number | null;
    date_collecte?: string;
    packs_antgaspi?: PackPrix | PackPrix[] | null;
    evenements?: { organisation_id?: string | null; lieu_id?: string | null };
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

  // (2) Montant de la prestation (Val 2026-11-03), indépendant de la facture.
  let montants: (number | null)[];
  try {
    montants = await montantsPrestation(
      supabase,
      rows.map((r) => ({
        type: r.type ?? '',
        pax: r.pax ?? null,
        date_collecte: r.date_collecte ?? '',
        organisation_id: r.evenements?.organisation_id ?? null,
        lieu_id: r.evenements?.lieu_id ?? null,
        pack: Array.isArray(r.packs_antgaspi)
          ? (r.packs_antgaspi[0] ?? null)
          : (r.packs_antgaspi ?? null),
      })),
    );
  } catch (e) {
    return serverError(e, 'admin.collectes.list.montants');
  }

  for (const [i, r] of rows.entries()) {
    r.envoi_abandonne = r.id != null && abandons.data.has(r.id);

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

    r.montant_ht = montants[i] ?? null;
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

  // L'ordre éventuel est en file : il part sans attendre le passage planifié
  // (décision Val 2026-10-12).
  envoyerOrdresSansAttendre(newId);

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
