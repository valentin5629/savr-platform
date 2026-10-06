import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { COLLECTES_PAGE_SIZE as PAGE_SIZE } from '@/lib/collectes-gestionnaire.js';
import { estUuid, listeCsv } from '@/lib/filtre-csv.js';
import { parsePage } from '@/lib/pagination.js';
import { lireTri } from '@/lib/tri-liste.js';

// Colonnes triables de la liste (paramètre `tri`) → colonnes SQL.
const TRIS = {
  date: ['date_collecte'],
  type: ['type', 'date_collecte'],
  statut: ['statut', 'date_collecte'],
} satisfies Record<string, string[]>;

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Brackets « Taille d'événement » (§06.05 l.115) traduits en prédicats PostgREST
// sur `evenements.pax`. Table de CONSTANTES : la valeur reçue du client sert de
// clé, elle n'est jamais interpolée dans la chaîne `.or()`.
//
// Les clés héritées (`toString`, `constructor`, `__proto__`, `valueOf`…) sont
// fermées par DEUX gardes indépendantes — il faut défaire les deux pour rouvrir
// quoi que ce soit, et c'est mesuré : annuler la seule `Map` laisse la sonde
// `collectes_route_taille_cle_heritee_rejetee` au VERT.
//   • `Map` plutôt qu'objet littéral : pas de chaîne de prototypes, donc
//     `?taille_evenements[]=toString` rend `undefined` là où `OBJ['toString']`
//     rendrait la fonction native. Son apport PROPRE est ailleurs : elle protège
//     d'une pollution réelle de `Object.prototype` par une dépendance tierce, qui
//     pourrait y poser une *chaîne* — le seul cas où la garde de type céderait.
//   • `typeof pred === 'string'` (plus bas) : rejette tout ce qui n'est pas une
//     chaîne. Mesuré sur un objet littéral : les 12 clés héritées rendent des
//     `function`/`object`, aucune n'est une chaîne — donc toutes écartées.
// Un code non reconnu tombe alors dans le court-circuit « aucune taille
// reconnue » et rend une liste vide, sans jamais atteindre PostgREST.
//
// ⚠ `pax` NULL compte **XS**, parce que la liste Événements du même espace calcule
// `tailleBracket(pax ?? 0)`. Sans `pax.is.null` ici, le même filtre donnerait deux
// périmètres différents selon l'écran qu'on regarde.
//
// ⚠ Ces prédicats doivent rester **en SQL**. La route voisine `gestionnaire/
// evenements` filtre ses brackets en JS après la requête — elle le peut, elle
// n'est pas paginée. Ici, un filtrage post-`.range()` filtrerait une PAGE au lieu
// de l'ensemble et laisserait `total` à sa valeur non filtrée : la pagination
// redeviendrait mensongère, ce que ce même écran vient de corriger.
const PREDICAT_TAILLE = new Map<string, string>([
  ['XS', 'pax.is.null,pax.lt.250'],
  ['S', 'and(pax.gte.250,pax.lt.500)'],
  ['M', 'and(pax.gte.500,pax.lt.750)'],
  ['L', 'and(pax.gte.750,pax.lt.1000)'],
  ['XL', 'pax.gte.1000'],
]);

// Embed to-one PostgREST : objet ou tableau selon le cache de schéma.
type UnOuListe<T> = T | T[] | null;
function un<T>(v: UnOuListe<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Ligne telle que PostgREST la rend (embeds à agréger avant de répondre).
type LigneBrute = Record<string, unknown> & {
  collecte_flux: { poids_reel_kg: number | null }[] | null;
  attributions_antgaspi: UnOuListe<{ volume_repas_realise: number | null }>;
  evenements: UnOuListe<{
    nom_evenement: string | null;
    nom_client_organisateur: string | null;
    pax: number | null;
    lieux: UnOuListe<{
      nom: string | null;
      adresse_acces: string | null;
      code_postal: string | null;
      ville: string | null;
    }>;
    organisations: UnOuListe<{ nom: string | null }>;
  }>;
};

// GET /api/v1/gestionnaire/collectes
// Liste des collectes sur les lieux du gestionnaire. On interroge `collectes`
// DIRECTEMENT avec l'embed `evenements!inner` (même pattern éprouvé que la route
// /gestionnaire/filtres) : la RLS col_select (f_collecte_visible) scope au parc du
// gestionnaire, identique à la vue v_collectes_gestionnaire_lieux (= SELECT nu sur
// collectes, security_invoker). Bénéfice : les filtres lieu / traiteur (drill-down
// des Top listes du dashboard) sont applicables ET les noms lieu/événement sont
// enfin renvoyés (la vue ne les portait pas → colonnes « — »).
// Paramètres : type, statut, from, to, lieu_ids, traiteur_ids, page,
//              type_evenement_ids[], taille_evenements[]
//
// Lieu et Traiteur sont à choix multiple (Design System §5.5 règle 7, décision
// Val 2026-09-30) : `lieu_ids` / `traiteur_ids` en CSV, convention de
// `lib/filtre-csv` partagée avec les listes traiteur et agence. Les anciens
// `lieu_id` / `traiteur_id` à valeur unique restent lus comme une liste d'un
// élément. Ces listes ne font que RESTREINDRE : la requête part avec la session
// de l'utilisateur, donc la RLS col_select borne toujours la lecture à son parc
// — un identifiant d'un lieu qui n'est pas le sien ne rend aucune ligne.
//
// Pagination SERVEUR (`count: 'exact'` + `range`), pattern §06.06 admin/lieux.
// Décision Val 2026-09-22 : le §06.05 ne spécifie pas la taille de cette liste,
// et la route coupait à 100 lignes SANS le dire — un parc de plus de 100
// collectes affichait une liste d'apparence complète qui ne l'était pas.
// Le §06.05 l.209 veut au contraire cette liste LARGE (« tous statuts, type
// ZD/AG non figé »), ce qui fait mordre le plafond d'autant plus vite. Le total
// exact renvoyé ici est ce qui rend la troncature VISIBLE : au-delà d'une page,
// lui seul dit combien de collectes existent dans le périmètre demandé.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type');
  const statut = sp.get('statut');
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuxDemandes = listeCsv(
    sp.get('lieu_ids') ?? sp.get('lieu_id'),
    Boolean,
  );
  const traiteursDemandes = listeCsv(
    sp.get('traiteur_ids') ?? sp.get('traiteur_id'),
    Boolean,
  );
  const lieuIds = lieuxDemandes.filter(estUuid);
  const traiteurIds = traiteursDemandes.filter(estUuid);
  // Filtres globaux du dashboard, propagés par le drill-down des Top listes
  // (§06.05 l.209 : « filtres du dashboard propagés — période + Type/Taille
  // d'événement »). Mêmes noms de paramètres que `gestionnaire/evenements`.
  const typeEvtIds = sp.getAll('type_evenement_ids[]');
  const taillesDemandees = sp.getAll('taille_evenements[]');
  const predicatsTaille = taillesDemandees
    .map((code) => PREDICAT_TAILLE.get(code))
    .filter((pred): pred is string => typeof pred === 'string');
  // `page` sous la première (0, -3, « abc ») retombe sur 1 plutôt que de produire
  // un range négatif. Le dépassement par le HAUT ne se borne pas ici — le total
  // n'est pas encore connu — il est rattrapé après la requête (voir plus bas).
  const tri = lireTri(sp, TRIS, { tri: 'date', ascendant: false });
  const page = parsePage(sp);
  const offset = (page - 1) * PAGE_SIZE;

  // Tailles demandées mais AUCUNE reconnue (code hors XS…XL) : renvoyer la liste
  // non filtrée reviendrait à ignorer le filtre en silence — l'écran afficherait
  // un périmètre plus large que celui qu'il annonce. La réponse honnête est
  // « aucun événement n'a cette taille ».
  if (taillesDemandees.length > 0 && predicatsTaille.length === 0) {
    return NextResponse.json({ data: [], total: 0, page });
  }
  // Même règle pour Lieu et Traiteur : un identifiant mal formé est écarté (il
  // ne désigne aucune ligne), mais si AUCUN de ceux demandés n'est lisible, le
  // filtre ne s'efface pas pour autant.
  if (
    (lieuxDemandes.length > 0 && lieuIds.length === 0) ||
    (traiteursDemandes.length > 0 && traiteurIds.length === 0)
  ) {
    return NextResponse.json({ data: [], total: 0, page });
  }

  // Requête filtrée, sans fenêtrage : construite deux fois dans le cas dégradé
  // ci-dessous, donc les filtres vivent ici et nulle part ailleurs.
  const filtree = () => {
    // Mêmes colonnes que la liste traiteur, plus le traiteur (décision Val
    // 2026-10-01) : pax, adresse du lieu, résultats de la collecte réalisée
    // (poids ZD = Σ collecte_flux ; repas AG = volume de l'attribution, lu par la
    // vue v_attributions_gestionnaire — cf. aplatissement). Le traiteur passe par
    // la vue restreinte v_traiteurs_gestionnaire (nom seul), comme les autres
    // écrans du rôle.
    let q = supabase.from('collectes').select(
      `id, evenement_id, type, statut, statut_tms, date_collecte,
       heure_collecte, taux_recyclage, co2_evite_kg, realisee_at,
       collecte_flux(poids_reel_kg),
       attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise),
       evenements!inner(
         nom_evenement, nom_client_organisateur, pax, lieu_id,
         traiteur_operationnel_organisation_id,
         lieux!lieu_id(nom, adresse_acces, code_postal, ville),
         organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(nom)
       )`,
      { count: 'exact' },
    );
    // Tri de la Data Table (`tri` en liste blanche, `ordre` asc|desc ; défaut =
    // date décroissante). Côté serveur car la liste est paginée. `date_collecte`
    // seule n'est pas unique (plusieurs collectes le même jour) : sans départage,
    // deux pages successives peuvent réordonner les ex æquo et faire disparaître
    // une ligne d'une page à l'autre. `id` fige l'ordre.
    for (const c of tri.colonnes) q = q.order(c, { ascending: tri.ascendant });
    q = q.order('id', { ascending: tri.ascendant });

    if (type) q = q.eq('type', type);
    if (statut) q = q.eq('statut', statut);
    if (from) q = q.gte('date_collecte', from);
    if (to) q = q.lte('date_collecte', to);
    if (lieuIds.length > 0) q = q.in('evenements.lieu_id', lieuIds);
    if (traiteurIds.length > 0)
      q = q.in('evenements.traiteur_operationnel_organisation_id', traiteurIds);
    if (typeEvtIds.length > 0)
      q = q.in('evenements.type_evenement_id', typeEvtIds);
    // Un seul `.or()` pour tous les brackets retenus : ses termes sont OU-és entre
    // eux et l'ensemble est ET-é avec les filtres ci-dessus. Mesuré contre le
    // PostgREST local : `lieu_id` seul = 7 lignes, `lieu_id` + taille M = 6 — le
    // `.or()` ne désarme pas les filtres voisins.
    if (predicatsTaille.length > 0)
      q = q.or(predicatsTaille.join(','), { referencedTable: 'evenements' });
    return q;
  };

  let { data, error, count } = await filtree().range(
    offset,
    offset + PAGE_SIZE - 1,
  );

  // Page DEMANDÉE au-delà de la dernière : PostgREST répond 416 `PGRST103`.
  // Sans ce rattrapage, un lien partagé (`?page=4`), un favori, ou simplement une
  // liste qui a rétréci entre deux chargements affichent « Le chargement des
  // collectes a échoué » sur un parc parfaitement sain — une panne là où il n'y
  // en a pas, exactement le travers que ce lot corrige par ailleurs.
  // On relit alors le total pour que l'écran sache combien de pages existent et
  // puisse ramener l'utilisateur sur une page valide. Le `range(0, 0)` rejoue le
  // MÊME chemin de requête (plutôt qu'un `head: true` au comportement moins
  // évident avec l'embed `!inner`) et ne ramène qu'une ligne, jetée ensuite.
  if (error?.code === 'PGRST103') {
    const recompte = await filtree().range(0, 0);
    if (recompte.error)
      return serverError(recompte.error, 'gestionnaire.collectes.list');
    data = [];
    count = recompte.count;
    error = null;
  }

  if (error) return serverError(error, 'gestionnaire.collectes.list');

  // Aplatissement : les embeds bruts ne sortent pas de la route, l'écran n'en
  // lit que les agrégats.
  const rows = ((data ?? []) as unknown as LigneBrute[]).map((c) => {
    const { evenements, collecte_flux, attributions_antgaspi, ...rest } = c;
    const evt = un(evenements);
    const lieu = un(evt?.lieux ?? null);
    return {
      ...rest,
      evenement_nom: evt?.nom_evenement ?? null,
      // Client organisateur « si renseigné par le traiteur » (§06.05 Détail
      // événement) — même colonne que le détail, même RLS. Texte libre : une
      // saisie faite d'espaces vaut « non renseigné ».
      client_nom: evt?.nom_client_organisateur?.trim() || null,
      traiteur_nom: un(evt?.organisations ?? null)?.nom ?? null,
      pax: evt?.pax ?? null,
      lieu_nom: lieu?.nom ?? null,
      lieu_adresse:
        [lieu?.adresse_acces, lieu?.code_postal, lieu?.ville]
          .filter(Boolean)
          .join(' ') || null,
      poids_total_kg: (collecte_flux ?? []).reduce(
        (s, f) => s + (f.poids_reel_kg ?? 0),
        0,
      ),
      // Repas donnés — volume de l'attribution, par la vue
      // v_attributions_gestionnaire (§04) : aa_select refuse la table au
      // gestionnaire sur une collecte d'un traiteur tiers (C-1), la vue rend le
      // volume des collectes de SES lieux. Même source que la fiche et l'export.
      nb_repas_donnes: un(attributions_antgaspi)?.volume_repas_realise ?? null,
    };
  });

  return NextResponse.json({ data: rows, total: count ?? rows.length, page });
}
