import {
  logIntegration,
  type IntegrationLogEntry,
} from './integrations-log.js';

export type TvaVerificationResult =
  | 'verifie'
  | 'echec'
  | 'down'
  | 'non_applicable';

// En test, le mock prend le relais via mockViesVerify()
let mockFn: ((tva: string) => TvaVerificationResult) | null = null;

export function _setViesMock(
  fn: ((tva: string) => TvaVerificationResult) | null,
): void {
  mockFn = fn;
}

const VIES_ENDPOINT = 'vies.rest-api.vat';

// Pur : mappe la réponse VIES au verdict + libellé d'erreur pour le log. VIES n'est
// JAMAIS bloquant (§04/§15) : tout `!ok` (y compris 429 rate-limit) → 'down' (alerte
// in-app seule côté appelant). VOLET 3 R22g : 429 déjà couvert par `!ok` → 'down'.
export function classifyViesResult(
  ok: boolean,
  isValid: boolean | undefined,
  status: number,
): { result: TvaVerificationResult; erreur: string | null } {
  if (!ok)
    return {
      result: 'down',
      erreur: status === 429 ? 'VIES rate-limited (429)' : `VIES ${status}`,
    };
  if (isValid === true) return { result: 'verifie', erreur: null };
  if (isValid === false) return { result: 'echec', erreur: 'TVA invalide' };
  return { result: 'down', erreur: 'VIES réponse inattendue' };
}

// Pur : ligne integrations_logs d'un appel VIES. correlation_id = n° TVA normalisé
// (réf métier, table staff seule). Aucun en-tête/secret (VIES est non authentifié).
export function buildViesLogEntry(args: {
  statut_http: number | null;
  duree_ms: number;
  tva: string;
  erreur: string | null;
}): IntegrationLogEntry {
  return {
    integration: 'vies',
    direction: 'sortant',
    methode: 'GET',
    endpoint: VIES_ENDPOINT,
    statut_http: args.statut_http,
    duree_ms: args.duree_ms,
    correlation_id: args.tva,
    erreur: args.erreur,
  };
}

export async function verifyTva(
  tva: string | null | undefined,
): Promise<TvaVerificationResult> {
  if (!tva || tva.trim() === '') return 'non_applicable';

  if (process.env.NODE_ENV === 'test') {
    return mockFn ? mockFn(tva) : 'down';
  }

  // Numéro TVA intracom : 2 lettres pays + 2-13 chiffres
  const normalised = tva.replace(/\s/g, '').toUpperCase();
  const countryCode = normalised.slice(0, 2);
  const numero = normalised.slice(2);

  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${encodeURIComponent(countryCode)}/vat/${encodeURIComponent(numero)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      },
    );

    let isValid: boolean | undefined;
    if (res.ok) {
      const json = (await res.json()) as { isValid?: boolean };
      isValid = json.isValid;
    }
    const { result, erreur } = classifyViesResult(res.ok, isValid, res.status);
    await logIntegration(
      buildViesLogEntry({
        statut_http: res.status,
        duree_ms: Date.now() - t0,
        tva: normalised,
        erreur,
      }),
    );
    return result;
  } catch (err) {
    // TVA VIES jamais bloquante — timeout ou réseau → down
    await logIntegration(
      buildViesLogEntry({
        statut_http: null,
        duree_ms: Date.now() - t0,
        tva: normalised,
        erreur: err instanceof Error ? err.name : 'erreur réseau',
      }),
    );
    return 'down';
  }
}
