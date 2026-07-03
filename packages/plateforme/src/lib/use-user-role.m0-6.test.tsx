/**
 * M0.6 — Hook useUserRole (gating UI admin-only, §06.06 §8 + §09).
 * Prouve que le rôle est lu depuis le claim JWT RÉEL `user_role` de la session
 * navigateur (jamais `role`), base du bandeau « Lecture seule » ops.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockGetSession = vi.fn();
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession: mockGetSession } }),
}));

import { useUserRole } from './use-user-role';

function makeToken(claims: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;
}

beforeEach(() => {
  mockGetSession.mockReset();
});

describe('M0.6 — useUserRole', () => {
  it('lit le claim user_role (admin_savr)', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: makeToken({ user_role: 'admin_savr' }) },
      },
    });
    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current).toBe('admin_savr'));
  });

  it('lit le claim user_role (ops_savr)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: makeToken({ user_role: 'ops_savr' }) } },
    });
    const { result } = renderHook(() => useUserRole());
    await waitFor(() => expect(result.current).toBe('ops_savr'));
  });

  it('undefined sans session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useUserRole());
    // Laisse l'effet se résoudre puis vérifie l'absence de rôle.
    await waitFor(() => expect(mockGetSession).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});
