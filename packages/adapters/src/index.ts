// Interface logistique_provider — types réels + factory (M1.5a).
//
// CLAUDE.md §2 + §3bis : la Plateforme ne parle JAMAIS directement à MTS-1 /
// Everest depuis le code métier. Tout passe par cette interface. La factory
// `getLogistiqueProvider` est le SEUL endroit hors `packages/adapters/` où
// l'enum `type_tms` apparaît (chemin allowlisté dans
// scripts/coupling-allowlist.txt — garde-fou 3).
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
// Types métier — champs minimum requis pour le dispatch MTS-1.
// ---------------------------------------------------------------------------

export interface Lieu {
  readonly id: string;
  readonly nom: string;
  readonly adresse_acces: string;
  readonly code_postal: string;
  readonly ville: string;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly acces_details?: string | null;
  readonly type_vehicule_max: string;
  readonly contraintes_horaires?: string | null;
}

export interface Collecte {
  readonly id: string;
  readonly type: 'zero_dechet' | 'anti_gaspi';
  readonly date_collecte: string; // ISO date 'YYYY-MM-DD'
  readonly heure_collecte: string; // 'HH:MM:SS'
  readonly nb_camions_demande: number;
  readonly statut_tms: string;
  readonly controle_acces_requis: boolean;
  readonly informations_supplementaires?: string | null;
  readonly notes_internes?: string | null;
  readonly lieu: Lieu;
  readonly contact_principal_nom: string;
  readonly contact_principal_telephone: string;
  readonly contact_secours_nom?: string | null;
  readonly contact_secours_telephone?: string | null;
  // AG uniquement
  readonly association_id_point_collecte_mts1?: string | null;
}

export interface Transporteur {
  readonly id: string;
  readonly type_tms: TypeTms;
  readonly code_transporteur_mts1?: string | null;
  readonly prestataire_logistique_id: string;
}

export interface FenetreSync {
  readonly depuis: Date;
  readonly jusqu_a: Date;
}

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
import type { SupabaseClient } from '@supabase/supabase-js';

import { AdapterMts1 } from './mts1/adapter.js';
import { ProviderManual } from './manual/provider.js';

export function getLogistiqueProvider(
  transporteur: Transporteur,
  supabase: SupabaseClient,
): LogistiqueProvider {
  switch (transporteur.type_tms) {
    case 'mts1':
      return new AdapterMts1(transporteur, supabase);
    case 'a_toutes':
      // Gate 2026-06-08 : Everest hors périmètre go-live (V1.1).
      throw new LogistiquePermanentError(
        'Everest non disponible — gate 2026-06-08, disponible V1.1',
      );
    case 'autre':
      return new ProviderManual(transporteur);
    default: {
      const _exhaustive: never = transporteur.type_tms;
      throw new LogistiquePermanentError(
        `type_tms inconnu : ${String(_exhaustive)}`,
      );
    }
  }
}
