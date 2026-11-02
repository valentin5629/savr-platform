import { estUuid } from './filtre-csv';
import type {
  StatutCollecteAdmin,
  StatutCollecteDb,
} from './statut-collecte-labels';

// Statut de collecte AFFICHÉ côté Admin (décision Val 2026-10-07, §06.06 §3).
// L'enum DB `programmee` couvre deux moments que l'Admin doit distinguer :
//   « Créée »      = le traiteur a validé sa programmation, rien n'est parti ;
//   « Programmée » = la demande est partie vers le prestataire logistique.
// Affichage dérivé : ni l'enum ni la machine à états (§05) ne changent, et la
// vue client garde son libellé unique « Créée ».
//
// « Partie » se lit dès le clic de l'Admin (« Valider et envoyer », « Valider
// et dispatcher (manuel) », « Envoyer »), sans attendre que le worker ait
// transmis l'ordre — et vaut aussi pour un transporteur joint par mail ou
// téléphone, pour qui rien ne part automatiquement. D'où quatre signaux, dont
// un seul suffit : un prestataire posé sur la collecte (dispatch), une
// attribution AG (seule trace quand le transporteur n'a pas de prestataire
// relié ; la ligne n'existe que validée, seule `rpc_valider_attribution_ag`
// l'écrit), un statut TMS sorti de « non envoyé », une référence de commande
// reçue.
//
// Exception (décision Val 2026-11-02) : un envoi abandonné ramène à « Créée ».
// Quand l'ordre de création parti vers le prestataire est abandonné (plus
// aucune tentative automatique) et que rien n'en est revenu (statut TMS « non
// envoyé », aucune référence), la demande n'est jamais arrivée : l'Admin doit
// la retrouver parmi ce qu'il reste à envoyer. Un échec avec reprise planifiée
// ne change rien. L'abandon ne se lit que dans la file d'envoi
// (`outbox_events`), d'où `envoi_abandonne` posé par l'appelant
// (`lireCollectesEnvoiAbandonne`, lib/ordre-envoi).
//
// La règle vit ici sous deux formes côte à côte : test d'une ligne déjà
// chargée (`statutCollecteAdmin`) et filtre PostgREST de la liste Collectes Admin
// (`filtreStatutsAdmin`). Leur accord est tenu par statut-collecte-admin.test.ts.

/** Ce qu'il faut lire d'une collecte pour savoir si sa demande est partie. */
export interface EnvoiCollecte {
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
  prestataire_logistique_id: string | null;
  /** Embed `attributions_antgaspi` (objet, tableau ou null selon la route). */
  attributions_antgaspi: unknown;
  /** Ordre de création abandonné dans la file d'envoi (absent = non). */
  envoi_abandonne?: boolean;
}

function demandeEnvoyee(c: Omit<EnvoiCollecte, 'statut'>): boolean {
  if (
    c.envoi_abandonne === true &&
    c.statut_tms === 'non_envoye' &&
    c.tms_reference == null
  )
    return false;
  const attribution = c.attributions_antgaspi;
  const attribuee = Array.isArray(attribution)
    ? attribution.length > 0
    : attribution != null;
  return (
    c.statut_tms !== 'non_envoye' ||
    c.tms_reference != null ||
    c.prestataire_logistique_id != null ||
    attribuee
  );
}

/** Clé d'affichage Admin d'une collecte (`statutCollecteDisplay(…, 'admin')`). */
export function statutCollecteAdmin(c: EnvoiCollecte): StatutCollecteAdmin {
  if (c.statut !== 'programmee') return c.statut as StatutCollecteDb;
  return demandeEnvoyee(c) ? 'programmee' : 'creee';
}

// Les mêmes quatre signaux en syntaxe PostgREST (colonnes de `collectes` +
// embed `attributions_antgaspi`, à embarquer dans le select appelant), puis
// l'exception de l'envoi abandonné, lue sur la liste d'identifiants fournie.
const DEMANDE_NON_ENVOYEE =
  'statut_tms.eq.non_envoye,tms_reference.is.null,prestataire_logistique_id.is.null,attributions_antgaspi.is.null';
const DEMANDE_ENVOYEE =
  'statut_tms.neq.non_envoye,tms_reference.not.is.null,prestataire_logistique_id.not.is.null,attributions_antgaspi.not.is.null';
const abandonne = (ids: string) =>
  `id.in.(${ids}),statut_tms.eq.non_envoye,tms_reference.is.null`;
const nonAbandonne = (ids: string) =>
  `id.not.in.(${ids}),statut_tms.neq.non_envoye,tms_reference.not.is.null`;

// Statuts qu'un Admin peut filtrer : un brouillon n'apparaît pas côté Admin.
const CLES_FILTRABLES: readonly StatutCollecteAdmin[] = [
  'creee',
  'programmee',
  'validee',
  'en_cours',
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulation_demandee',
  'annulee',
  'rejetee_par_prestataire',
];

/**
 * Traduit une sélection de statuts Admin en filtre de requête : soit une liste
 * de statuts DB (`statuts`), soit une expression `or=(…)` quand « Créée » ou
 * « Programmée » est choisie sans l'autre. Clés inconnues ignorées ; `null` si
 * rien de valide n'est demandé. `idsEnvoiAbandonne` : collectes dont l'ordre de
 * création est abandonné (`lireCollectesEnvoiAbandonne`), validées en UUID ici
 * car elles partent dans un `or=(…)` non paramétré.
 */
export function filtreStatutsAdmin(
  cles: readonly string[],
  idsEnvoiAbandonne: readonly string[] = [],
): { statuts: StatutCollecteDb[] } | { or: string } | null {
  const valides = CLES_FILTRABLES.filter((c) => cles.includes(c));
  if (valides.length === 0) return null;
  const creee = valides.includes('creee');
  const programmee = valides.includes('programmee');
  // « Réalisée » couvre aussi la collecte AG sans excédent : même libellé à
  // l'écran, le filtre n'en propose donc qu'une (décision Val 2026-10-09).
  const autres = [
    ...new Set(
      valides
        .filter(
          (c): c is StatutCollecteDb => c !== 'creee' && c !== 'programmee',
        )
        .flatMap<StatutCollecteDb>((c) =>
          c === 'realisee' ? ['realisee', 'realisee_sans_collecte'] : [c],
        ),
    ),
  ];
  if (creee === programmee) {
    return { statuts: creee ? ['programmee', ...autres] : autres };
  }
  const ids = idsEnvoiAbandonne.filter(estUuid).join(',');
  const moitie = creee
    ? ids
      ? `and(statut.eq.programmee,or(and(${DEMANDE_NON_ENVOYEE}),and(${abandonne(ids)})))`
      : `and(statut.eq.programmee,${DEMANDE_NON_ENVOYEE})`
    : ids
      ? `and(statut.eq.programmee,or(${DEMANDE_ENVOYEE}),or(${nonAbandonne(ids)}))`
      : `and(statut.eq.programmee,or(${DEMANDE_ENVOYEE}))`;
  return {
    or:
      autres.length > 0 ? `${moitie},statut.in.(${autres.join(',')})` : moitie,
  };
}
