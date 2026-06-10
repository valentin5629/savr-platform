// Interface logistique_provider — stub types + signatures only (module 0.1).
//
// CLAUDE.md §2 + §3bis : la Plateforme ne parle JAMAIS directement à MTS-1 /
// Everest depuis le code métier. Tout passe par cette interface. La factory
// `getLogistiqueProvider` est le SEUL endroit hors `packages/adapters/` où
// l'enum `type_tms` apparaît (chemin allowlisté dans
// scripts/coupling-allowlist.txt — garde-fou 3).
//
// Impl. réelles (adapter_mts1 V1, adapter_everest V1.1 — gate, provider_manual
// V1 no-op) = verticale logistique, module 0.5. Stub volontairement plat ici.
//
// Sans état : retry / routage erreurs = worker outbox, jamais le provider.
// Ne touche JAMAIS collectes.statut (dérivé par trigger depuis statut_tms).

// ---------------------------------------------------------------------------
// Enum type_tms (porté par `plateforme.transporteurs.type_tms`)
// ---------------------------------------------------------------------------
export type TypeTms = 'mts1' | 'a_toutes' | 'autre';

// ---------------------------------------------------------------------------
// Référence neutre côté Plateforme — garde-fou 5
// Naming canonique figé 2026-06-10 : `external_ref_commande` porté par
// `plateforme.tournees`. Une collecte multi-camions = N tournées, donc N refs.
// (Ancien `external_ref_logistique` = obsolète, ne pas réintroduire.)
// ---------------------------------------------------------------------------
export type ExternalRefCommande = string;

// ---------------------------------------------------------------------------
// Erreurs typées — le worker route, le provider lève.
// ---------------------------------------------------------------------------
export class LogistiqueProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LogistiqueProviderError';
  }
}
/** 4xx — pas de retry, notif Admin. */
export class LogistiquePermanentError extends LogistiqueProviderError {
  override readonly name = 'LogistiquePermanentError';
}
/** 5xx / réseau — retry 3 paliers 5 min / 1 h / 24 h. */
export class LogistiqueTransientError extends LogistiqueProviderError {
  override readonly name = 'LogistiqueTransientError';
}
/** Timeout — pas de retry auto, vérif existence avant re-POST. */
export class LogistiqueAmbiguousError extends LogistiqueProviderError {
  override readonly name = 'LogistiqueAmbiguousError';
}
/** Annulation < 1 h côté MTS-1 — bascule Ops manuel. */
export class CancelWindowClosedError extends LogistiqueProviderError {
  override readonly name = 'CancelWindowClosedError';
}

// ---------------------------------------------------------------------------
// Types métier — placeholders 0.1. Remplacés par les types réels du data model
// (`@savr/shared`) une fois la verticale logistique câblée (module 0.5).
// ---------------------------------------------------------------------------
export type Collecte = unknown;
export type Lieu = unknown;
export type Transporteur = { readonly type_tms: TypeTms };
export type FenetreSync = { readonly depuis: Date; readonly jusqu_a: Date };

// ---------------------------------------------------------------------------
// Interface logistique_provider — 5 méthodes (4 sortantes E1/E2/E3/E5 + sync).
// ---------------------------------------------------------------------------
export interface LogistiqueProvider {
  /** E1 `collecte.creee` — appelée rang=1..nb_camions_demande. */
  dispatchCollecte(collecte: Collecte, rang: number): Promise<void>;
  /** E2 `collecte.modifiee`. */
  updateCollecte(collecte: Collecte): Promise<void>;
  /** E3 `collecte.annulee`. */
  cancelCollecte(collecte: Collecte): Promise<void>;
  /** E5 `lieu.champ_critique_modifie`. */
  updateLieu(lieu: Lieu): Promise<void>;
  /** Cron 15 min — écrit `statut_tms`, pesées, photos, tournees. */
  sync(fenetre: FenetreSync): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory — seul endroit hors adapters où `type_tms` apparaît (allowlist G3).
// ---------------------------------------------------------------------------
export declare function getLogistiqueProvider(
  transporteur: Transporteur,
): LogistiqueProvider;
