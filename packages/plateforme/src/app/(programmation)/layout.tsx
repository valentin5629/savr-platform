'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { AppShell } from '@/components/layout/app-shell';
import type { Role } from '@/lib/nav-config';

function parseJwt(token: string): Record<string, unknown> {
  try {
    return JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf-8'),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function ProgrammationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [role, setRole] = useState<Role>('traiteur_commercial');

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (token) {
        const claims = parseJwt(token);
        const r = claims['user_role'] as Role | undefined;
        if (r) setRole(r);
      }
    });
  }, []);

  return (
    <AppShell role={role} pageTitle="Programmer une collecte">
      {children}
    </AppShell>
  );
}
