'use client';

import * as React from 'react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';

/**
 * Lit le rôle métier RÉEL de l'utilisateur courant depuis le claim JWT
 * `user_role` de la session navigateur (jamais le claim `role`, réservé
 * PostgREST — cf. [[project-rls-user-role-claim]]). Sert au gating UI des
 * actions admin-only (bandeau « Lecture seule » ops sur la fiche organisation,
 * §06.06 §8 + §09/§15). La sécurité réelle reste côté serveur (routes
 * `requireAdmin`/`requireStaff`) : ce hook ne fait que refléter le droit pour
 * masquer/désactiver les actions.
 */
function decodeClaim(
  token: string | undefined,
  key: string,
): string | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return (JSON.parse(atob(padded)) as Record<string, string>)[key];
  } catch {
    return undefined;
  }
}

export function useUserRole(): string | undefined {
  const [role, setRole] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      setRole(decodeClaim(session?.access_token, 'user_role'));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return role;
}
