import {
  logIntegration,
  type IntegrationLogEntry,
} from './integrations-log.js';
import { estSiret } from '../validation/index.js';

export type SiretVerificationResult = 'verifie' | 'echec' | 'down';

// Format SIRET : 14 chiffres exactement (5 SIREN + 5 + 4 NIC). Garde de saisie en amont
// de l'appel INSEE — un format invalide est une erreur utilisateur (422), pas un 'echec' INSEE.
// Aligné §06.11 RPC f_completer_siret_shadow (« format 14 chiffres »).
// Regex partagée (R-UI-5 F9) ; le trim des bords reste propre à ce site.
export function isValidSiretFormat(siret: string): boolean {
  return estSiret(siret.trim());
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

// API Sirene 3.11 derrière la passerelle du portail portail-api.insee.fr. L'ancienne
// adresse (api.insee.fr/entreprises/sirene/V3.11, jeton OAuth Bearer) coupe la connexion.
// Authentification = clé d'API de la souscription « Accès public » (30 requêtes/min, sans
// expiration), transmise dans un en-tête dédié — source : spec OpenAPI du portail
// (servers[0].url + securitySchemes.ApiKeyAuth).
const INSEE_SIRENE_BASE_URL = 'https://api.insee.fr/api-sirene/3.11';
const INSEE_API_KEY_HEADER = 'X-INSEE-Api-Key-Integration';

// Pur : mappe le statut HTTP INSEE au verdict + libellé d'erreur pour le log.
// VOLET 3 R22g (défensif) : 429 (rate-limit INSEE) → 'down' (transitoire, retenté par le
// cron revalidation-siret), JAMAIS 'echec' — un 'echec' serait interprété comme SIRET
// introuvable et figerait à tort l'entité en 'echec' de vérification.
// Même raisonnement pour 401 (clé absente, invalide ou révoquée) et 403 (droits
// insuffisants) : c'est NOTRE accès que la passerelle refuse, le SIRET n'a pas été jugé.
// Un 'echec' répondrait « SIRET inexistant » à l'utilisateur (422) pour une clé mal posée.
export function classifyInseeStatus(status: number): {
  result: SiretVerificationResult;
  erreur: string | null;
} {
  if (status === 200) return { result: 'verifie', erreur: null };
  if (status === 404)
    return { result: 'echec', erreur: 'SIRET introuvable (404)' };
  if (status === 429)
    return { result: 'down', erreur: 'INSEE rate-limited (429)' };
  if (status === 401 || status === 403)
    return { result: 'down', erreur: `INSEE accès refusé (${status})` };
  // INSEE répond un autre 4xx (ex: 400 format invalide) → echec de saisie
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

  // trim : un saut de ligne collé avec la clé rendrait l'en-tête invalide (fetch lève).
  const apiKey = process.env.INSEE_API_KEY?.trim();
  if (!apiKey) return 'down'; // aucun appel émis → rien à journaliser

  const t0 = Date.now();
  try {
    const res = await fetch(
      `${INSEE_SIRENE_BASE_URL}/siret/${encodeURIComponent(siret)}`,
      {
        headers: {
          [INSEE_API_KEY_HEADER]: apiKey,
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
