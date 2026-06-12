import {
  _setInseeMock,
  type SiretVerificationResult,
} from '../../api/siret.js';
import { _setViesMock, type TvaVerificationResult } from '../../api/tva.js';

/**
 * Configure le mock INSEE pour un SIRET donné.
 * Appeler dans beforeEach/afterEach pour isoler les tests.
 *
 * @example
 * mockInseeVerify('12345678901234', 'verifie');
 */
export function mockInseeVerify(
  siret: string,
  state: SiretVerificationResult,
): () => void {
  const map = new Map<string, SiretVerificationResult>([[siret, state]]);

  _setInseeMock((s) => map.get(s) ?? 'down');

  return () => _setInseeMock(null);
}

/**
 * Configure le mock VIES pour un numéro TVA donné.
 *
 * @example
 * mockViesVerify('FR12345678901', 'verifie');
 */
export function mockViesVerify(
  tva: string,
  state: TvaVerificationResult,
): () => void {
  const map = new Map<string, TvaVerificationResult>([[tva, state]]);

  _setViesMock((t) => map.get(t) ?? 'down');

  return () => _setViesMock(null);
}

/**
 * Réinitialise tous les mocks INSEE/VIES.
 * À appeler dans afterEach si plusieurs mocks sont configurés.
 */
export function clearInseViesMocks(): void {
  _setInseeMock(null);
  _setViesMock(null);
}
