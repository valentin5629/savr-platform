import { Constants } from '@savr/shared/src/database.types.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import {
  applyChipPredicate,
  isChipKey,
  type ChipQuery,
} from '@/lib/collectes-chips.js';
import { estUuid, listeCsv, parmi } from '@/lib/filtre-csv.js';
import { filtreStatutsAdmin } from '@/lib/statut-collecte-admin.js';

// Filtres de la liste Collectes Admin (§06.06 §3) : UNE lecture et UNE
// application, partagées par la route de la liste (GET /admin/collectes) et par
// son export CSV (GET /exports/collectes, staff) — le fichier porte exactement
// les lignes de la liste (§12 §2 « l'export respecte les filtres actifs »).
// Tri et page n'en font pas partie : ils restent à la route.

/**
 * Lit les filtres de la liste Collectes Admin. Listes à choix multiple en CSV
 * (`types`, `traiteur_operationnel_ids`, `lieu_ids`), validées avant `.in()` et
 * prioritaires sur leur équivalent à valeur unique (décision Val 2026-09-30).
 */
export function lireFiltresCollectesAdmin(sp: URLSearchParams) {
  return {
    // Clés d'AFFICHAGE Admin (CSV `statuts`, ou l'ancien mono `statut`) : les
    // statuts DB, où `programmee` veut dire « demande partie », plus `creee`
    // pour sa moitié « non partie » (décision Val 2026-10-07). Liste blanche
    // dans `filtreStatutsAdmin`.
    statutsDemandes: (sp.get('statuts') ?? sp.get('statut') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    types: listeCsv(
      sp.get('types'),
      parmi(Constants.plateforme.Enums.collecte_type),
    ),
    type: sp.get('type'),
    statutTms: sp.get('statut_tms'),
    chip: sp.get('chip'),
    from: sp.get('from'),
    to: sp.get('to'),
    organisationId: sp.get('organisation_id'), // organisation programmatrice
    // Filtre « traiteur » = traiteur OPÉRATIONNEL (décision Val R24c : un
    // traiteur = son activité d'opérateur, y compris sous-traité pour une
    // agence). Miroir exact du Top 5 traiteurs des dashboards.
    traiteurOperationnelIds: listeCsv(
      sp.get('traiteur_operationnel_ids'),
      estUuid,
    ),
    traiteurOperationnelId: sp.get('traiteur_operationnel_id'),
    // Périmètre d'organisations (drill-down depuis le Dashboard Client Admin) —
    // une org matche si elle est programmatrice OU traiteur opérationnel. Validé
    // en UUID : la valeur est interpolée dans un `.or()` non paramétré.
    perimetreOrgIds: sp.getAll('perimetre_org_ids[]').filter(estUuid),
    lieuIds: listeCsv(sp.get('lieu_ids'), estUuid),
    lieuId: sp.get('lieu_id'),
    infoIncomplete: sp.get('info_incomplete') === 'true',
    // « Infos accès à envoyer » = contrôle d'accès requis ET aucun envoi de
    // l'email réservé (tampon posé AVANT l'envoi, retiré si l'email est perdu)
    // ET à venir.
    controleAcces: sp.get('controle_acces') === 'true',
    rapportNonConsulte: sp.get('rapport_non_consulte') === 'true',
  };
}

export type FiltresCollectesAdmin = ReturnType<
  typeof lireFiltresCollectesAdmin
>;

// Sous-ensemble du builder PostgREST utilisé ici (même raison que `ChipQuery` :
// le type générique complet déclenche TS2589). Les appelants passent leur
// builder concret et le récupèrent tel quel.
interface RequeteCollectes {
  eq(column: string, value: unknown): RequeteCollectes;
  neq(column: string, value: unknown): RequeteCollectes;
  is(column: string, value: unknown): RequeteCollectes;
  in(column: string, values: readonly unknown[]): RequeteCollectes;
  not(column: string, operator: string, value: unknown): RequeteCollectes;
  gte(column: string, value: unknown): RequeteCollectes;
  lte(column: string, value: unknown): RequeteCollectes;
  or(filters: string, options?: { referencedTable?: string }): RequeteCollectes;
}

/**
 * Applique les filtres de la liste Collectes Admin à une requête `collectes`.
 * Le select appelant doit embarquer `evenements!inner`, `attributions_antgaspi`
 * (pastille « AG en attente attribution », statuts « Créée » / « Programmée »)
 * et, quand `rapportNonConsulte` est demandé, `rapports_rse` en `!inner` — sans
 * cet embed PostgREST refuse la requête, il ne l'élargit pas.
 * `now` est injecté pour les fenêtres 48 h des pastilles et « à venir ».
 */
export function appliquerFiltresCollectesAdmin<Q>(
  requete: Q,
  f: FiltresCollectesAdmin,
  now: Date,
): Q {
  let q = requete as unknown as RequeteCollectes;

  // Pastilles prédéfinies (§06.06 §3) — prédicats partagés avec /chip-counts.
  if (f.chip && isChipKey(f.chip)) {
    q = applyChipPredicate(q as ChipQuery, f.chip, now) as RequeteCollectes;
  }

  // Filtres de la barre — cumulés avec une pastille (décision Val
  // 2026-09-30) : la liste = pastille ET barre ; sans filtre posé, elle reste
  // le miroir exact du compteur de la pastille.
  // Un brouillon vit dans le formulaire du programmeur (« Mes brouillons ») : il
  // n'apparaît dans aucune liste Admin (décision Val 2026-10-07).
  q = q.neq('statut', 'brouillon');
  if (f.statutsDemandes.length > 0) {
    const filtre = filtreStatutsAdmin(f.statutsDemandes);
    // Rien de valide demandé (clé inconnue, brouillon) : aucune ligne, jamais
    // une liste élargie.
    if (!filtre) q = q.in('statut', []);
    else if ('or' in filtre) q = q.or(filtre.or);
    else q = q.in('statut', filtre.statuts);
  }
  if (f.types.length > 0) q = q.in('type', f.types);
  else if (f.type) q = q.eq('type', f.type);
  if (f.statutTms) q = q.eq('statut_tms', f.statutTms);
  if (f.from) q = q.gte('date_collecte', f.from);
  if (f.to) q = q.lte('date_collecte', f.to);
  if (f.organisationId)
    q = q.eq('evenements.organisation_id', f.organisationId);
  if (f.traiteurOperationnelIds.length > 0)
    q = q.in(
      'evenements.traiteur_operationnel_organisation_id',
      f.traiteurOperationnelIds,
    );
  else if (f.traiteurOperationnelId)
    q = q.eq(
      'evenements.traiteur_operationnel_organisation_id',
      f.traiteurOperationnelId,
    );
  if (f.perimetreOrgIds.length > 0) {
    const ids = f.perimetreOrgIds.join(',');
    q = q.or(
      `organisation_id.in.(${ids}),traiteur_operationnel_organisation_id.in.(${ids})`,
      { referencedTable: 'evenements' },
    );
  }
  if (f.lieuIds.length > 0) q = q.in('evenements.lieu_id', f.lieuIds);
  else if (f.lieuId) q = q.eq('evenements.lieu_id', f.lieuId);
  if (f.infoIncomplete) q = q.eq('informations_completes', false);
  // Miroir EXACT du compteur KPI `controle_acces_a_envoyer` (chip-counts) :
  // requis ET aucun envoi de l'email récap réservé ET à venir → compteur = liste.
  if (f.controleAcces) {
    q = q
      .eq('controle_acces_requis', true)
      .is('infos_acces_email_envoye_at', null)
      .gte('date_collecte', jourParis(now));
  }
  if (f.rapportNonConsulte) q = q.is('rapports_rse.consulte_par_user_at', null);

  return q as unknown as Q;
}
