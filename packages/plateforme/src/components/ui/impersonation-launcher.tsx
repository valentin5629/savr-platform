'use client';

import * as React from 'react';
import { UserCog } from 'lucide-react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { Button } from '@/components/ui/button';

interface UserRow {
  id: string;
  prenom: string;
  nom: string;
  email: string;
  role: string;
  organisations?: { raison_sociale?: string | null } | null;
}

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

const ROLE_LABELS: Record<string, string> = {
  admin_savr: 'Admin Savr',
  ops_savr: 'Ops Savr',
  traiteur_manager: 'Traiteur (manager)',
  traiteur_commercial: 'Traiteur (commercial)',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire lieux',
  client_organisateur: 'Client organisateur',
};

/**
 * Lanceur d'impersonation (§09 §7) — réservé admin_savr. Liste les utilisateurs et,
 * au clic, appelle POST /api/v1/admin/users/[id]/impersoner puis navigue vers le
 * lien callback (établit la session impersonée → bandeau orange). Remplace le
 * déclenchement manuel ; BL-P1-BOA-09 (volet impersonation UI).
 */
export function ImpersonationLauncher(): React.ReactElement | null {
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [selfId, setSelfId] = React.useState<string | undefined>(undefined);
  const [users, setUsers] = React.useState<UserRow[]>([]);
  const [selected, setSelected] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      // Réservé admin_savr : ops_savr n'a pas le droit d'impersonation (§09).
      if (decodeClaim(session?.access_token, 'user_role') !== 'admin_savr')
        return;
      setIsAdmin(true);
      setSelfId(decodeClaim(session?.access_token, 'sub'));

      const res = await fetch('/api/v1/admin/users?actif=true');
      if (!cancelled && res.ok) {
        const j = (await res.json()) as { data: UserRow[] };
        setUsers(j.data ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleImpersonate = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${selected}/impersoner`, {
        method: 'POST',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Erreur lors du démarrage de l'impersonation");
        setLoading(false);
        return;
      }
      const j = (await res.json()) as { lien_impersonation: string };
      window.location.href = j.lien_impersonation;
    } catch {
      setError('Erreur réseau');
      setLoading(false);
    }
  };

  if (!isAdmin) return null;

  const candidats = users.filter((u) => u.id !== selfId);

  return (
    <div className="rounded-md border border-savr-neutral-200 bg-savr-neutral-50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <UserCog className="w-4 h-4 text-savr-neutral-600" aria-hidden="true" />
        <span className="text-sm font-medium text-savr-neutral-700">
          Impersonation
        </span>
        <span className="text-xs text-savr-neutral-500">
          Se connecter à la place d&apos;un utilisateur (support / debug)
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Utilisateur à impersonner"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-[22rem] px-3 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-savr-primary-500"
        >
          <option value="">Choisir un utilisateur…</option>
          {candidats.map((u) => (
            <option key={u.id} value={u.id}>
              {u.prenom} {u.nom} — {u.email} · {ROLE_LABELS[u.role] ?? u.role}
              {u.organisations?.raison_sociale
                ? ` (${u.organisations.raison_sociale})`
                : ''}
            </option>
          ))}
        </select>
        <Button onClick={handleImpersonate} disabled={!selected || loading}>
          <UserCog className="w-4 h-4" />
          {loading ? 'Connexion…' : 'Impersoner'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-savr-error">{error}</p>}
    </div>
  );
}
