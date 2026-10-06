import { NextRequest, NextResponse } from 'next/server';
import { NAV_CONFIG } from '@/lib/nav-config';
import type { NavRole as Role } from '@/lib/roles';

const VALID_ROLES: Role[] = [
  'admin_savr',
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
];

export function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get('role') as Role | null;

  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: 'Paramètre role manquant ou invalide', validRoles: VALID_ROLES },
      { status: 400 },
    );
  }

  const groups = NAV_CONFIG[role] ?? [];
  const items = groups.flatMap((g) =>
    g.items.map((item) => ({ label: item.label, href: item.href })),
  );

  return NextResponse.json({ role, items });
}
