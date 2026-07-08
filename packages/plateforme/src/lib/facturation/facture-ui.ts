// Helpers d'affichage SLA Pennylane facture (§06.08 §2.3 / §4). Fonctions PURES
// (aucune dépendance React / horloge implicite) → testables en isolation avec un
// `nowMs` injecté (oracle pastille_orange_borne_2h, borne stricte). Utilisées par la
// liste Admin (pastille) et la fiche facture (bandeau « dernier essai il y a Xmin »).

export const PASTILLE_2H_MS = 2 * 60 * 60 * 1000;

/**
 * Pastille orange §06.08 §2.3/§4 : une facture `en_attente_pennylane` depuis
 * STRICTEMENT plus de 2 h (référence = dernier essai Pennylane). Borne stricte —
 * oracle Gherkin `pastille_orange_borne_2h` : exactement 2h00 → pas de pastille,
 * 2h01 → pastille.
 */
export function pastillePennylane2h(
  statut: string,
  derniereTentativeIso: string | null | undefined,
  nowMs: number,
): boolean {
  if (statut !== 'en_attente_pennylane') return false;
  if (!derniereTentativeIso) return false;
  const t = new Date(derniereTentativeIso).getTime();
  if (Number.isNaN(t)) return false;
  return nowMs - t > PASTILLE_2H_MS;
}

/**
 * « il y a X min » / « il y a X h Y min » depuis un timestamp — pour le bandeau
 * fiche « En attente d'envoi Pennylane — dernier essai : il y a Xmin » (§06.08 §2.3).
 */
export function tempsEcouleFr(
  iso: string | null | undefined,
  nowMs: number,
): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const min = Math.floor(Math.max(0, nowMs - t) / 60000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  const restMin = min % 60;
  return restMin === 0 ? `il y a ${h} h` : `il y a ${h} h ${restMin} min`;
}

/**
 * « En retard » §06.08 §8/§10 — calculé en lecture, jamais stocké. Borne STRICTE au
 * grain JOUR (oracle `en_retard_calcule_bornes_echeance`) : une facture `emise` est
 * en retard ssi `date_echeance < aujourd'hui` — l'échéance du jour même n'est PAS en
 * retard. `date_echeance` est une DATE (YYYY-MM-DD) → comparaison de dates civiles
 * (pas d'heure), pour ne pas marquer « en retard » dès minuit le jour de l'échéance.
 */
export function estEnRetard(
  statut: string,
  dateEcheanceIso: string | null | undefined,
  nowMs: number,
): boolean {
  if (statut !== 'emise') return false;
  if (!dateEcheanceIso) return false;
  const echeanceJour = dateEcheanceIso.slice(0, 10);
  const aujourdHui = new Date(nowMs).toISOString().slice(0, 10);
  return echeanceJour < aujourdHui;
}
