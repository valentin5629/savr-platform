// Briques communes aux routes d'options de la barre de filtres globale des
// dashboards : traiteur, agence et client organisateur (sous RLS), Dashboard
// Client Admin (service_role). Chaque route garde son contrôle d'accès, son
// client et son périmètre ; ici, seulement ce qu'elles partagent.

import { jourParis } from '@savr/shared/src/temps/index.js';

export interface OptionBarre {
  id: string;
  nom: string;
}

/** Fenêtre des options : collectes des 24 derniers mois (comme le gestionnaire). */
export function debutFenetreOptions(): string {
  const depuis = new Date();
  depuis.setMonth(depuis.getMonth() - 24);
  return jourParis(depuis);
}

/**
 * Brouillons et annulées ne comptent dans aucun bloc : leurs lieux ou clients
 * ne donneraient qu'un dashboard vide. Valeur du filtre `.not('statut', 'in', …)`.
 */
export const STATUTS_HORS_OPTIONS = '(brouillon,annulee)';

type Lieu = { id: string; nom: string | null };
interface EvtLu {
  nom_client_organisateur?: string | null;
  traiteur_operationnel_organisation_id: string | null;
  lieux: Lieu | Lieu[] | null;
}

/** Collecte lue pour les options : son événement, son lieu. */
export interface CollecteOptions {
  id: string;
  evenements: EvtLu | EvtLu[] | null;
}

const un = <T>(v: T | T[] | null): T | null =>
  !v ? null : Array.isArray(v) ? (v[0] ?? null) : v;

/** Options triées par libellé. */
export const trierOptions = (m: Map<string, string>): OptionBarre[] =>
  [...m.entries()]
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

/**
 * Lieux, clients organisateurs et traiteurs opérationnels des collectes lues.
 * Client : identifiant = nom tel que saisi (le filtre est une égalité exacte),
 * libellé débarrassé de ses espaces.
 */
export function optionsDepuisCollectes(lignes: CollecteOptions[]): {
  lieux: OptionBarre[];
  clients: OptionBarre[];
  traiteurIds: string[];
} {
  const lieux = new Map<string, string>();
  const clients = new Map<string, string>();
  const traiteurIds = new Set<string>();
  for (const ligne of lignes) {
    const evt = un(ligne.evenements);
    if (!evt) continue;
    const lieu = un(evt.lieux);
    if (lieu?.id) lieux.set(lieu.id, lieu.nom ?? 'Lieu');
    const client = evt.nom_client_organisateur;
    if (client?.trim()) clients.set(client, client.trim());
    if (evt.traiteur_operationnel_organisation_id)
      traiteurIds.add(evt.traiteur_operationnel_organisation_id);
  }
  return {
    lieux: trierOptions(lieux),
    clients: trierOptions(clients),
    traiteurIds: [...traiteurIds],
  };
}

/** Référentiel des types d'événement actifs, au format de la barre. */
export async function lireTypesEvenementsActifs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from: (table: string) => any },
): Promise<{
  data: { id: string; libelle: string }[];
  error: { message: string } | null;
}> {
  const { data, error } = await client
    .from('types_evenements')
    .select('id, libelle')
    .eq('actif', true)
    .order('ordre_affichage', { ascending: true });
  return {
    data: ((data ?? []) as { id: string; libelle: string }[]).map((t) => ({
      id: t.id,
      libelle: t.libelle,
    })),
    error,
  };
}
