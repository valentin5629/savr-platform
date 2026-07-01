'use client';

import * as React from 'react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { ImpersonationBanner } from '@/components/ui/impersonation-banner';

interface ImpersonationClaims {
  impersonator_id?: string;
  email?: string;
  exp?: number;
}

function decodeClaims(accessToken: string | undefined): ImpersonationClaims {
  if (!accessToken) return {};
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return {};
    // JWT = base64url SANS padding → reconstruire du base64 standard paddé pour atob.
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as ImpersonationClaims;
  } catch {
    return {};
  }
}

/**
 * Monté au layout racine (couvre tous les rôles, l'utilisateur impersoné pouvant
 * être n'importe lequel). Affiche le bandeau orange permanent tant que la session
 * porte le claim `impersonator_id` (§09 §7 + §15 §2.3), gère « Quitter » et la fin
 * automatique au bout d'1h (basée sur l'expiration du token, alignée sur la fenêtre
 * enforce côté hook). BL-P1-AUTH-01.
 */
export function ImpersonationBannerMount(): React.ReactElement | null {
  const [userName, setUserName] = React.useState<string | null>(null);

  const handleExit = React.useCallback(async () => {
    try {
      await fetch('/api/auth/exit-impersonation', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }, []);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    void (async () => {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;

      const claims = decodeClaims(session?.access_token);
      if (!claims.impersonator_id) {
        setUserName(null);
        return;
      }

      setUserName(claims.email ?? 'cet utilisateur');

      // Fin auto : à l'expiration du token (~1h), qui coïncide avec la fenêtre
      // d'impersonation posée par le callback. Le hook cesse d'injecter le claim
      // passé l'heure ; ce timer force la sortie côté UI sans attendre un refresh.
      if (claims.exp) {
        const ms = claims.exp * 1000 - Date.now();
        timer = setTimeout(() => void handleExit(), Math.max(0, ms));
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [handleExit]);

  if (!userName) return null;

  return <ImpersonationBanner userName={userName} onExit={handleExit} />;
}
