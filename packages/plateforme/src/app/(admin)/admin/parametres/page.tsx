'use client';

import Link from 'next/link';
import {
  Users,
  Table2,
  Package,
  Recycle,
  Leaf,
  Sparkles,
  CheckCheck,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';

interface ParamLink {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
}

// Sous-sections §9 Paramètres livrées en V1 (Référentiels / Intégrations /
// Configuration générale = reportés R18b, cf. _Divergences).
const SECTIONS: ParamLink[] = [
  {
    label: 'Utilisateurs',
    href: '/admin/settings/users',
    icon: Users,
    description: 'Comptes staff Savr (admin / ops)',
  },
  {
    label: 'Grilles tarifaires ZD',
    href: '/admin/parametres/grilles-zd',
    icon: Table2,
    description: 'Catalogue des grilles ZD + versionnement',
  },
  {
    label: 'Tarifs packs AG',
    href: '/admin/parametres/tarifs-ag',
    icon: Package,
    description: 'Grille publique des packs Anti-Gaspi',
  },
  {
    label: 'Taux de recyclage',
    href: '/admin/parametres/taux-recyclage',
    icon: Recycle,
    description: 'Taux de captation par filière',
  },
  {
    label: 'Facteurs CO₂',
    href: '/admin/parametres/co2',
    icon: Leaf,
    description: 'Facteurs ADEME, mix emballages, forfaits',
  },
  {
    label: 'Algo attribution AG',
    href: '/admin/parametres/algo-ag',
    icon: Sparkles,
    description: 'Paramètres pilotables de l’algo AG',
  },
  {
    label: 'Auto-accept AG',
    href: '/admin/parametres/auto-accept',
    icon: CheckCheck,
    description: 'Combinaisons association × type d’événement',
  },
  {
    label: 'Templates emails',
    href: '/admin/parametres/templates',
    icon: Mail,
    description: '19 templates actifs (consultation)',
  },
];

export default function ParametresIndexPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-savr-neutral-900">Paramètres</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card className="p-5 h-full hover:border-savr-primary-300 hover:shadow-sm transition-all">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-savr-primary-50 p-2">
                    <Icon className="h-5 w-5 text-savr-primary-700" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-savr-neutral-800">
                      {s.label}
                    </h2>
                    <p className="text-sm text-savr-neutral-500 mt-0.5">
                      {s.description}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
