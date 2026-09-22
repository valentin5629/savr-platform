import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { COLLECTES_PAGE_SIZE as PAGE_SIZE } from '@/lib/collectes-gestionnaire.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Brackets « Taille d'événement » (§06.05 l.115) traduits en prédicats PostgREST
// sur `evenements.pax`. Table de CONSTANTES : la valeur reçue du client sert de
// clé, elle n'est jamais interpolée dans la chaîne `.or()`.
//
// ⚠ `Map` et NON objet littéral. Avec un objet, `PREDICAT_TAILLE[code]` remonte
// la chaîne de prototypes : `?taille_evenements[]=toString` rendait la fonction
// native `Object.prototype.toString` — truthy, donc admise par la garde — et
// `join(',')` la sérialisait dans le filtre (« function toString() { [native
// code] } »). PostgREST répondait 400, donc l'écran affichait une panne, et le
// court-circuit ci-dessous était contourné. Un `Map` n'a pas de clés héritées :
// `constructor`, `__proto__`, `valueOf`, `toString` sont tous rejetés.
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

// GET /api/v1/gestionnaire/collectes
// Liste des collectes sur les lieux du gestionnaire. On interroge `collectes`
// DIRECTEMENT avec l'embed `evenements!inner` (même pattern éprouvé que la route
// /gestionnaire/filtres) : la RLS col_select (f_collecte_visible) scope au parc du
// gestionnaire, identique à la vue v_collectes_gestionnaire_lieux (= SELECT nu sur
// collectes, security_invoker). Bénéfice : les filtres lieu / traiteur (drill-down
// des Top listes du dashboard) sont applicables ET les noms lieu/événement sont
// enfin renvoyés (la vue ne les portait pas → colonnes « — »).
// Paramètres : type, statut, from, to, lieu_id, traiteur_id, page,
//              type_evenement_ids[], taille_evenements[]
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
  const lieuId = sp.get('lieu_id');
  const traiteurId = sp.get('traiteur_id');
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
  const pageParam = Number.parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageParam) ? Math.max(1, pageParam) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  // Tailles demandées mais AUCUNE reconnue (code hors XS…XL) : renvoyer la liste
  // non filtrée reviendrait à ignorer le filtre en silence — l'écran afficherait
  // un périmètre plus large que celui qu'il annonce. La réponse honnête est
  // « aucun événement n'a cette taille ».
  if (taillesDemandees.length > 0 && predicatsTaille.length === 0) {
    return NextResponse.json({ data: [], total: 0, page });
  }

  // Requête filtrée, sans fenêtrage : construite deux fois dans le cas dégradé
  // ci-dessous, donc les filtres vivent ici et nulle part ailleurs.
  const filtree = () => {
    let q = supabase
      .from('collectes')
      .select(
        `id, evenement_id, type, statut, statut_tms, date_collecte,
       heure_collecte, taux_recyclage, co2_evite_kg, realisee_at,
       evenements!inner(
         nom_evenement, lieu_id, traiteur_operationnel_organisation_id,
         lieux!lieu_id(nom)
       )`,
        { count: 'exact' },
      )
      // `date_collecte` seule n'est pas unique (plusieurs collectes le même jour) :
      // sans départage, deux pages successives peuvent réordonner les ex æquo et
      // faire disparaître une ligne d'une page à l'autre. `id` fige l'ordre.
      .order('date_collecte', { ascending: false })
      .order('id', { ascending: false });

    if (type) q = q.eq('type', type);
    if (statut) q = q.eq('statut', statut);
    if (from) q = q.gte('date_collecte', from);
    if (to) q = q.lte('date_collecte', to);
    if (lieuId) q = q.eq('evenements.lieu_id', lieuId);
    if (traiteurId)
      q = q.eq('evenements.traiteur_operationnel_organisation_id', traiteurId);
    if (typeEvtIds.length > 0)
      q = q.in('evenements.type_evenement_id', typeEvtIds);
    // Un seul `.or()` pour tous les brackets retenus : ses termes sont OU-és entre
    // eux et l'ensemble est ET-é avec les filtres ci-dessus. Mesuré contre le
    // PostgREST local : `lieu_id` seul = 7 lignes, `lieu_id` + taille M = 6 — le
    // `.or()` ne désarme pas les `.eq()` voisins.
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

  // Aplatissement des noms (to-one PostgREST = objet ou tableau selon le cache).
  const rows = (data ?? []).map((c) => {
    const { evenements, ...rest } = c as typeof c & {
      evenements:
        | {
            nom_evenement: string | null;
            lieux: { nom: string | null } | { nom: string | null }[] | null;
          }
        | {
            nom_evenement: string | null;
            lieux: { nom: string | null } | { nom: string | null }[] | null;
          }[]
        | null;
    };
    const evt = Array.isArray(evenements) ? evenements[0] : evenements;
    const lieu = evt
      ? Array.isArray(evt.lieux)
        ? evt.lieux[0]
        : evt.lieux
      : null;
    return {
      ...rest,
      evenement_nom: evt?.nom_evenement ?? null,
      lieu_nom: lieu?.nom ?? null,
    };
  });

  return NextResponse.json({ data: rows, total: count ?? rows.length, page });
}
