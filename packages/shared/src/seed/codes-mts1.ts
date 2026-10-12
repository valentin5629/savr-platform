/**
 * Codes transporteurs MTS-1 du jeu de données (dev only).
 *
 * Le code d'un transporteur (`carrierShareableCode`) est propre à UN compte
 * MTS-1. Avec une valeur inventée, la commande et la tournée sont bien créées
 * chez MTS-1, mais le dispatch au transporteur est refusé
 * (`400 INVALID_REQUEST`, constaté le 2026-10-12 sur le compte de démonstration).
 *
 * Les codes du compte de démonstration se posent dans `.env.local`, jamais dans
 * le dépôt (il est public) — décision Val 2026-10-12. Sans variable, la valeur
 * inventée reste : le jeu de données se charge, mais un envoi réel vers ce
 * transporteur échouera au dispatch.
 */
import { loadEnv } from './db.js';

const VARIABLES = {
  strike: 'SEED_MTS1_CODE_STRIKE',
  marathon: 'SEED_MTS1_CODE_MARATHON',
  transnormandie: 'SEED_MTS1_CODE_TRANSNORMANDIE',
} as const;

const CODES_INVENTES = {
  strike: 'STRIKE-MTS1',
  marathon: 'MARATHON-MTS1',
  transnormandie: 'TRANSNOR-MTS1',
} as const;

export type TransporteurSeed = keyof typeof VARIABLES;

type Env = Record<string, string | undefined>;

// `.env.local` (clone principal), puis l'environnement du processus, qui prime.
// Un worktree n'a pas de `.env.local` : on retombe alors sur l'environnement seul.
function lireEnv(): Env {
  try {
    return { ...loadEnv(), ...process.env };
  } catch {
    return process.env;
  }
}

/** Code MTS-1 du transporteur : variable d'environnement, sinon valeur inventée. */
export function codeMts1Seed(
  transporteur: TransporteurSeed,
  env: Env = lireEnv(),
): string {
  return env[VARIABLES[transporteur]]?.trim() || CODES_INVENTES[transporteur];
}
