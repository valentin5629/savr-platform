'use client';

import { AppShell } from '@/components/layout/app-shell';
import type { Role } from '@/lib/nav-config';
import { useUserRole } from '@/lib/use-user-role';

export default function ProgrammationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Le rôle pilote la nav de l'AppShell. On lit le claim `user_role` via
  // useUserRole (décodage `atob` navigateur). ⚠ L'ancien décodage `Buffer.from`
  // échouait silencieusement côté client (Buffer absent du bundle) → le rôle
  // restait bloqué sur le défaut `traiteur_commercial` : admin/agence/gestionnaire
  // voyaient la nav traiteur et le formulaire n'affichait pas leur sélecteur.
  const role = (useUserRole() ?? 'traiteur_commercial') as Role;

  return (
    <AppShell role={role} pageTitle="Programmer une collecte">
      {children}
    </AppShell>
  );
}
