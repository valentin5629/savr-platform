/**
 * Jeton du lien d'invitation (CDC §06.02 §17 : valable 7 jours, décision Val
 * 2026-10-28) : signé, daté, impossible à falsifier ou à prolonger.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  creerJetonInvitation,
  DUREE_INVITATION_MS,
  lireJetonInvitation,
  nouveauNonce,
} from '../../src/lib/auth/jeton-invitation.js';

const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'cle-de-service-de-test');
});

function jeton(expireA = T0 + DUREE_INVITATION_MS) {
  return creerJetonInvitation({ userId: 'u-1', nonce: 'n-1', expireA });
}

describe('jeton d’invitation', () => {
  it('se relit tel quel pendant 7 jours', () => {
    const lecture = lireJetonInvitation(jeton(), T0 + DUREE_INVITATION_MS - 1);
    expect(lecture).toEqual({
      ok: true,
      userId: 'u-1',
      nonce: 'n-1',
      expireA: T0 + DUREE_INVITATION_MS,
    });
  });

  it('expire au bout de 7 jours', () => {
    expect(lireJetonInvitation(jeton(), T0 + DUREE_INVITATION_MS)).toEqual({
      ok: false,
      motif: 'expire',
    });
  });

  it('refuse une charge modifiée (prolongation ou autre compte)', () => {
    const [, signature] = jeton().split('.');
    const prolongee = Buffer.from(
      JSON.stringify({ u: 'u-1', n: 'n-1', e: T0 + 365 * DUREE_INVITATION_MS }),
    ).toString('base64url');
    const autreCompte = Buffer.from(
      JSON.stringify({ u: 'u-2', n: 'n-1', e: T0 + DUREE_INVITATION_MS }),
    ).toString('base64url');
    for (const charge of [prolongee, autreCompte]) {
      expect(lireJetonInvitation(`${charge}.${signature}`, T0)).toEqual({
        ok: false,
        motif: 'invalide',
      });
    }
  });

  it('refuse un jeton signé avec une autre clé', () => {
    const j = jeton();
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'une-autre-cle');
    expect(lireJetonInvitation(j, T0)).toEqual({
      ok: false,
      motif: 'invalide',
    });
  });

  it.each([
    ['absent', undefined],
    ['vide', ''],
    ['sans signature', 'abc'],
    ['trois parties', 'a.b.c'],
    ['trop long', 'a'.repeat(1001)],
  ])('refuse un jeton %s', (_cas, valeur) => {
    expect(lireJetonInvitation(valeur, T0)).toEqual({
      ok: false,
      motif: 'invalide',
    });
  });

  it('refuse une signature tronquée', () => {
    expect(lireJetonInvitation(jeton().slice(0, -3), T0)).toEqual({
      ok: false,
      motif: 'invalide',
    });
  });

  it('produit des nonces différents', () => {
    expect(nouveauNonce()).not.toBe(nouveauNonce());
  });
});
