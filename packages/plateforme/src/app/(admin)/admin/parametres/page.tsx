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
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { ROUTES } from '@/lib/routes';

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
    href: ROUTES.admin.settingsUsers,
    icon: Users,
    description: 'Comptes staff Savr (admin / ops)',
  },
  {
    label: 'Grilles tarifaires ZD',
    href: ROUTES.admin.parametresGrillesZd,
    icon: Table2,
    description: 'Catalogue des grilles ZD + versionnement',
  },
  {
    label: 'Tarifs packs AG',
    href: ROUTES.admin.parametresTarifsAg,
    icon: Package,
    description: 'Grille publique des packs Anti-Gaspi',
  },
  {
    label: 'Taux de recyclage',
    href: ROUTES.admin.parametresTauxRecyclage,
    icon: Recycle,
    description: 'Taux de captation par filière',
  },
  {
    label: 'Facteurs CO₂',
    href: ROUTES.admin.parametresCo2,
    icon: Leaf,
    description: 'Facteurs ADEME, mix emballages, forfaits',
  },
  {
    label: 'Algo attribution AG',
    href: ROUTES.admin.parametresAlgoAg,
    icon: Sparkles,
    description: 'Paramètres pilotables de l’algo AG',
  },
  {
    label: 'Auto-accept AG',
    href: ROUTES.admin.parametresAutoAccept,
    icon: CheckCheck,
    description: 'Combinaisons association × type d’événement',
  },
  {
    label: 'Templates emails',
    href: ROUTES.admin.parametresTemplates,
    icon: Mail,
    description: '20 templates actifs (consultation)',
  },
];

export default function ParametresIndexPage() {
  return (
    <div className="space-y-6">
      <Heading level={1}>Paramètres</Heading>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card
                padding="md"
                className="h-full hover:border-savr-primary-300 hover:shadow-savr-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-savr-md bg-savr-primary-50 p-2">
                    <Icon className="h-5 w-5 text-savr-primary-700" />
                  </div>
                  <div>
                    <Heading level={2} size="inherit" tone="strong">
                      {s.label}
                    </Heading>
                    <Text className="mt-0.5">{s.description}</Text>
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
