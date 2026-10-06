import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, BookOpen, Plus, Truck } from 'lucide-react';
import {
  Sec,
  Legende,
  FICHE_AG,
  TOP_ITEMS,
  CO2_ZD,
  METHODE,
  LIGNES_TABLE,
} from './common-6c';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import { Co2HeroCard } from '@/components/dashboards/charts/cockpit/Co2HeroCard';
import { Co2MethodePanel } from '@/components/dashboards/charts/cockpit/Co2MethodePanel';
import { TonnageDisplay } from '@/components/dashboards/TonnageDisplay';
import { OngletBilan } from '@/components/collecte/fiche-collecte-client-bilan';
import { Sidebar } from '@/components/layout/sidebar';
import { ROUTES } from '@/lib/routes';
import { PageHeader } from '@/components/ui/page-header';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

// R-UI-6c « avant » — build avec REPO = worktree de origin/main (9d61883c) :
// tous les composants sont ceux de main. Les pages listes (fetch) et mon-profil
// (session serveur) ne sont pas rendables ici : on rend leur en-tête avec le JSX
// et les props EXACTS de la page sur main (transporteurs/page.tsx l.197,
// alertes/page.tsx l.175, registre/page.tsx l.292, traiteur/mon-profil l.15).
// Le reste (Badge, Table, TopRankList, Co2HeroCard, TonnageDisplay,
// OngletBilan, Co2MethodePanel, Sidebar) = composants réels, données factices
// identiques à l'« après » (common-6c.tsx).
function EnTetes(_w: 'desktop' | 'mobile') {
  return (
    <div className="space-y-6">
      <Legende>admin/transporteurs — PageHeader tone=neutral</Legende>
      <PageHeader
        title="Transporteurs"
        tone="neutral"
        icon={<Truck className="h-6 w-6 text-savr-neutral-600" />}
        actions={
          <Button onClick={noop}>
            <Plus />
            Nouveau transporteur
          </Button>
        }
      />
      <Legende>admin/alertes — Heading + Text (recette de la page)</Legende>
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-savr-primary-600" />
        <div>
          <Heading level={1} weight="semibold" tone="inherit">
            Alertes
          </Heading>
          <Text>
            Alertes Admin in-app à traiter (packs, pesées, PDF, facturation,
            dispatch…). Le canal d&apos;action des alertes fonctionnelles est
            cet écran, pas Slack.
          </Text>
        </div>
      </div>
      <Legende>registre — PageHeader</Legende>
      <PageHeader
        title="Registre réglementaire"
        actions={
          <>
            <Button variant="ghost" asChild>
              <a href={ROUTES.registreMethodologie}>Méthodologie</a>
            </Button>
            <Button variant="ghost" onClick={noop}>
              Exporter CSV
            </Button>
            <Button onClick={noop}>Télécharger tous les bordereaux</Button>
          </>
        }
      />
    </div>
  );
}

function EnTeteProfil() {
  return (
    <Heading level={1} tone="primary">
      Mon profil
    </Heading>
  );
}
function Corps({ en }: { en: (w: 'desktop' | 'mobile') => React.ReactNode }) {
  return (
    <div className="bg-savr-neutral-50">
      <Sec id="listes" title={TITRE_LISTES}>
        {en('desktop')}
      </Sec>
      <Sec id="listes-mobile" title={TITRE_LISTES} width={375}>
        {en('mobile')}
      </Sec>
      <Sec id="pageheader-iso" title={TITRE_PROFIL}>
        <MonProfil />
      </Sec>
      <Sec
        id="tailles"
        title="Q9 — Badge size=sm, Table (TableHead), TopRankList, Co2HeroCard (largeur modale wide 720 px)"
      >
        <div className="grid grid-cols-[1fr_380px] gap-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
              <Badge size="sm" variant="success">
                Clôturée
              </Badge>
              <Badge size="sm" variant="action">
                À compléter
              </Badge>
              <Badge size="sm" variant="info">
                Programmée
              </Badge>
              <Badge size="sm" variant="error">
                Refusée
              </Badge>
              <Badge size="sm" variant="neutral">
                Annulée
              </Badge>
              <Badge size="sm" variant="count">
                3
              </Badge>
              <span className="text-xs text-savr-neutral-400">
                ← Badge size="sm"
              </span>
            </div>
            <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Référence</TableHead>
                    <TableHead>Lieu</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="text-right">Poids collecté</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {LIGNES_TABLE.map((l) => (
                    <TableRow key={l.ref}>
                      <TableCell>{l.ref}</TableCell>
                      <TableCell>{l.lieu}</TableCell>
                      <TableCell>
                        <Badge size="sm" variant={l.v}>
                          {l.statut}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">1 240 kg</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <TopRankList
            title="Top lieux"
            subtitle="Tonnage"
            avatarTint="navy"
            showBar
            items={TOP_ITEMS}
          />
        </div>
        <div className="mt-6" style={{ width: 720 }}>
          <Co2HeroCard {...CO2_ZD} />
        </div>
      </Sec>
      <Sec id="tailles-mobile" title="Co2HeroCard sous 640 px" width={375}>
        <Co2HeroCard {...CO2_ZD} />
      </Sec>
      <Sec
        id="masse-co2"
        title="Q5 TonnageDisplay (seuil kg→t) · Q6 StatCard CO₂ du bilan (OngletBilan AG réel) · Co2MethodePanel"
      >
        <div className="grid grid-cols-4 gap-3">
          {[999, 3400, 10000, 12000].map((kg) => (
            <div
              key={kg}
              className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4"
            >
              <div className="font-mono text-[10px] text-savr-neutral-400">{`<TonnageDisplay kg={${kg}} />`}</div>
              <TonnageDisplay
                kg={kg}
                className="text-2xl font-bold text-savr-neutral-900"
              />
            </div>
          ))}
        </div>
        <div className="mt-6">
          <OngletBilan
            c={FICHE_AG}
            base="/api/v1/traiteur/collectes/c1"
            espace="traiteur"
          />
        </div>
        <div
          className="mt-6 rounded-savr-xl bg-savr-white p-6"
          style={{ width: 720 }}
        >
          <Co2MethodePanel {...METHODE} />
        </div>
      </Sec>
      <Sec
        id="residus"
        title="Résidus rounded-full → rounded-savr-full : Sidebar (barre active, pastille repliée), point du Badge"
      >
        <div className="flex items-start gap-6">
          <div style={{ height: 560 }}>
            <Sidebar role="admin_savr" navBadges={{ '/admin/alertes': 3 }} />
          </div>
          <div style={{ height: 560 }}>
            <Sidebar
              role="admin_savr"
              collapsed
              navBadges={{ '/admin/alertes': 3 }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="success">Clôturée</Badge>
            <Badge variant="warning">En attente</Badge>
            <Badge variant="primary">Actif</Badge>
          </div>
        </div>
      </Sec>
    </div>
  );
}

const TITRE_LISTES =
  'Q3 — en-têtes des listes Transporteurs · Alertes · Registre';
const TITRE_PROFIL =
  'Q3 — écran non-liste : traiteur/mon-profil (en-tête + 1re carte)';

function MonProfil() {
  return (
    <div className="space-y-6">
      <EnTeteProfil />
      <Card>
        <CardHeader>
          <CardTitle>Compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-savr-neutral-500">Email : </span>
            marie@traiteur.fr
          </div>
          <div>
            <span className="text-savr-neutral-500">Rôle : </span>
            traiteur_manager
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const noop = () => {};
createRoot(document.getElementById('root')!).render(<Corps en={EnTetes} />);
