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

export async function verifyTva(
  tva: string | null | undefined,
): Promise<TvaVerificationResult> {
  if (!tva || tva.trim() === '') return 'non_applicable';

  if (process.env.NODE_ENV === 'test' && mockFn !== null) {
    return mockFn(tva);
  }

  // Numéro TVA intracom : 2 lettres pays + 2-13 chiffres
  const normalised = tva.replace(/\s/g, '').toUpperCase();
  const countryCode = normalised.slice(0, 2);

  try {
    const res = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${encodeURIComponent(countryCode)}/vat/${encodeURIComponent(normalised.slice(2))}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      },
    );

    if (!res.ok) return 'down';

    const json = (await res.json()) as { isValid?: boolean };
    if (json.isValid === true) return 'verifie';
    if (json.isValid === false) return 'echec';
    return 'down';
  } catch {
    // TVA VIES jamais bloquante — timeout ou réseau → down
    return 'down';
  }
}
