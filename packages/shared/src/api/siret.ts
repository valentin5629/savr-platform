export type SiretVerificationResult = 'verifie' | 'echec' | 'down';

// En test, le mock prend le relais via mockInseeVerify()
let mockFn: ((siret: string) => SiretVerificationResult) | null = null;

export function _setInseeMock(
  fn: ((siret: string) => SiretVerificationResult) | null,
): void {
  mockFn = fn;
}

export async function verifySiret(
  siret: string,
): Promise<SiretVerificationResult> {
  if (process.env.NODE_ENV === 'test' && mockFn !== null) {
    return mockFn(siret);
  }

  const token = process.env.INSEE_API_TOKEN;
  if (!token) return 'down';

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

    if (res.status === 200) return 'verifie';
    if (res.status === 404) return 'echec';
    // INSEE répond 4xx non-404 (ex: 400 format invalide) → echec de saisie
    if (res.status >= 400 && res.status < 500) return 'echec';
    // 5xx ou inattendu → indisponible
    return 'down';
  } catch {
    // timeout, réseau → down, inscription non bloquée
    return 'down';
  }
}
