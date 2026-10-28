import { NextResponse } from 'next/server';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { serverError } from '@/lib/api-helpers.js';

// Besoin véhicule d'une collecte (type souhaité + nombre de véhicules), saisi
// par l'Admin avant l'envoi au prestataire : à l'attribution AG (décision Val
// 2026-10-01) et au choix du prestataire d'une ZD (décision Val 2026-10-27).
// Écrit AVANT l'event de dispatch, que l'adapter lit ensuite.

// Valeurs de l'enum plateforme.type_vehicule (lieux.type_vehicule_max, tournees.type_vehicule).
export const TYPES_VEHICULE = [
  'velo_cargo',
  'camionnette',
  'fourgon',
  'vul',
  'poids_lourd',
] as const;

export const NB_VEHICULES_MAX = 20;

export interface BesoinVehicule {
  nb_camions_demande?: number;
  type_vehicule_souhaite?: string | null;
}

/** Contrôle du corps de requête : 422 si une valeur est hors bornes. */
export function refusBesoinVehicule(b: BesoinVehicule): NextResponse | null {
  const nb = b.nb_camions_demande;
  if (
    nb !== undefined &&
    (!Number.isInteger(nb) || nb < 1 || nb > NB_VEHICULES_MAX)
  ) {
    return NextResponse.json(
      { error: 'nb_camions_demande doit être un entier entre 1 et 20' },
      { status: 422 },
    );
  }
  const type = b.type_vehicule_souhaite;
  if (
    type !== undefined &&
    type !== null &&
    !(TYPES_VEHICULE as readonly string[]).includes(type)
  ) {
    return NextResponse.json(
      {
        error: `type_vehicule_souhaite invalide (attendu : ${TYPES_VEHICULE.join(', ')})`,
      },
      { status: 422 },
    );
  }
  return null;
}

/**
 * Écrit le besoin véhicule. Le nombre passe par fn_modifier_collecte (gardes
 * RM-02/RM-05, E2 si une commande existait déjà) ; le type est un UPDATE borné
 * aux statuts `statuts` (et au type de collecte s'il est donné). Rend la
 * réponse d'erreur à renvoyer, ou null si tout est écrit.
 */
export async function ecrireBesoinVehicule(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  collecteId: string,
  b: BesoinVehicule,
  garde: { statuts: string[]; type?: string },
  contexte: string,
): Promise<NextResponse | null> {
  if (b.nb_camions_demande !== undefined) {
    const { error: errNb } = await supabase.rpc('fn_modifier_collecte', {
      p_id: collecteId,
      p_updates: { nb_camions_demande: b.nb_camions_demande },
      p_champs_modifies: ['nb_camions_demande'],
    });
    if (errNb) {
      const msg = errNb.message ?? '';
      if (msg.includes('NB_CAMIONS_STATUT_TERMINAL')) {
        return NextResponse.json(
          {
            error:
              'Le nombre de véhicules n’est plus modifiable (statut terminal)',
          },
          { status: 409 },
        );
      }
      if (msg.includes('NB_CAMIONS_INVALIDE')) {
        return NextResponse.json(
          { error: 'nb_camions_demande doit être un entier >= 1' },
          { status: 422 },
        );
      }
      if (msg.includes('REDUCTION_CANCEL_WINDOW_CLOSED')) {
        return NextResponse.json(
          {
            error:
              'Réduction du nombre de véhicules impossible à moins d’1h de la mission',
          },
          { status: 409 },
        );
      }
      return serverError(errNb, `${contexte}.nb_camions`);
    }
  }
  // Colonne absente (migration 20261001213000 pas encore appliquée : 42703 /
  // PGRST204) → l'envoi continue sans le type, tracé en warn, jamais un 500.
  if (b.type_vehicule_souhaite !== undefined) {
    let requete = supabase
      .from('collectes')
      .update({ type_vehicule_souhaite: b.type_vehicule_souhaite })
      .eq('id', collecteId);
    requete =
      garde.statuts.length === 1
        ? requete.eq('statut', garde.statuts[0]!)
        : requete.in('statut', garde.statuts);
    if (garde.type) requete = requete.eq('type', garde.type);
    const { error: errType } = await requete;
    if (errType) {
      if (errType.code === '42703' || errType.code === 'PGRST204') {
        logger.warn('besoin_vehicule.type_colonne_absente', {
          collecte_id: collecteId,
          error_code: errType.code,
        });
      } else {
        return serverError(errType, `${contexte}.type_vehicule`);
      }
    }
  }
  return null;
}
