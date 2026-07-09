import {
  logIntegration,
  type IntegrationLogEntry,
} from './integrations-log.js';

export type SiretVerificationResult = 'verifie' | 'echec' | 'down';

// Format SIRET : 14 chiffres exactement (5 SIREN + 5 + 4 NIC). Garde de saisie en amont
// de l'appel INSEE — un format invalide est une erreur utilisateur (422), pas un 'echec' INSEE.
// Aligné §06.11 RPC f_completer_siret_shadow (« format 14 chiffres »).
export function isValidSiretFormat(siret: string): boolean {
  return /^\d{14}$/.test(siret.trim());
}

// En test, le mock prend le relais via mockInseeVerify()
let mockFn: ((siret: string) => SiretVerificationResult) | null = null;

export function _setInseeMock(
  fn: ((siret: string) => SiretVerificationResult) | null,
): void {
  mockFn = fn;
}

// Endpoint symbolique journalisé (pas l'URL avec le SIRET interpolé — le SIRET va dans
// correlation_id, cf. buildInseeLogEntry). Stable pour le regroupement Ops par tiers.
const INSEE_ENDPOINT = 'insee.sirene.v3.siret';

// Pur : mappe le statut HTTP INSEE au verdict + libellé d'erreur pour le log.
// VOLET 3 R22g (défensif) : 429 (rate-limit INSEE) → 'down' (transitoire, retenté par le
// cron revalidation-siret), JAMAIS 'echec' — un 'echec' serait interprété comme SIRET
// introuvable et figerait à tort l'entité en 'echec' de vérification.
export function classifyInseeStatus(status: number): {
  result: SiretVerificationResult;
  erreur: string | null;
} {
  if (status === 200) return { result: 'verifie', erreur: null };
  if (status === 404)
    return { result: 'echec', erreur: 'SIRET introuvable (404)' };
  if (status === 429)
    return { result: 'down', erreur: 'INSEE rate-limited (429)' };
  // INSEE répond 4xx non-404/429 (ex: 400 format invalide) → echec de saisie
  if (status >= 400 && status < 500)
    return { result: 'echec', erreur: `INSEE ${status}` };
  // 5xx ou inattendu → indisponible
  return { result: 'down', erreur: `INSEE ${status}` };
}

// Pur : ligne integrations_logs d'un appel INSEE. correlation_id = SIRET vérifié
// (réf métier, table service_role/staff seule). Aucun en-tête/secret (cf. IntegrationLogEntry).
export function buildInseeLogEntry(args: {
  statut_http: number | null;
  duree_ms: number;
  siret: string;
  erreur: string | null;
}): IntegrationLogEntry {
  return {
    integration: 'insee',
    direction: 'sortant',
    methode: 'GET',
    endpoint: INSEE_ENDPOINT,
    statut_http: args.statut_http,
    duree_ms: args.duree_ms,
    correlation_id: args.siret,
    erreur: args.erreur,
  };
}

export async function verifySiret(
  siret: string,
): Promise<SiretVerificationResult> {
  if (process.env.NODE_ENV === 'test' && mockFn !== null) {
    return mockFn(siret);
  }

  const token = process.env.INSEE_API_TOKEN;
  if (!token) return 'down'; // aucun appel émis → rien à journaliser

  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://api.insee.fr/entreprises/sirene/V3.11/siret/${encodeURIComponent(siret)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3_000),
      },
    );

    const { result, erreur } = classifyInseeStatus(res.status);
    await logIntegration(
      buildInseeLogEntry({
        statut_http: res.status,
        duree_ms: Date.now() - t0,
        siret,
        erreur,
      }),
    );
    return result;
  } catch (err) {
    // timeout, réseau → down, inscription non bloquée (§04/§15)
    await logIntegration(
      buildInseeLogEntry({
        statut_http: null,
        duree_ms: Date.now() - t0,
        siret,
        erreur: err instanceof Error ? err.name : 'erreur réseau',
      }),
    );
    return 'down';
  }
}
