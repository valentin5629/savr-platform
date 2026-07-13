/**
 * R24 — smoke tests de la librairie data-viz « Cockpit » (rendu + contenu clé).
 * Composants présentationnels : on vérifie qu'ils rendent sans crash et
 * exposent leurs valeurs/structures signature (SVG, chiffres FR, états).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  FluxSeriePoint,
  RepasSeriePoint,
} from '@/components/dashboards/useEvolutionBlocs';
import { Sparkline } from './Sparkline';
import { KpiCockpitCard } from './KpiCockpitCard';
import { EvolutionZdChart } from './EvolutionZdChart';
import { TonnagesDonut } from './TonnagesDonut';
import { BenchmarkBulletGauges } from './BenchmarkBulletGauges';
import { Co2HeroCard } from './Co2HeroCard';
import { Co2HeroCardAg } from './Co2HeroCardAg';
import { PackAgRing } from './PackAgRing';
import { EvolutionAgChart } from './EvolutionAgChart';
import { TopRankList } from './TopRankList';
import { Co2MethodePanel } from './Co2MethodePanel';
import { Co2MethodePanelAg } from './Co2MethodePanelAg';

const zd: FluxSeriePoint[] = [
  {
    periode: '2025-06-01',
    biodechet: 4700,
    emballage: 1680,
    carton: 1300,
    verre: 850,
    dechet_residuel: 640,
    tonnage_total: 9170,
    taux_recyclage: 80,
  },
  {
    periode: '2025-07-01',
    biodechet: 5150,
    emballage: 1980,
    carton: 1540,
    verre: 980,
    dechet_residuel: 760,
    tonnage_total: 10410,
    taux_recyclage: 85,
  },
];
const ag: RepasSeriePoint[] = [
  { periode: '2025-06-01', repas_donnes: 3720, pax: 4300, ratio: 0.86 },
  { periode: '2025-07-01', repas_donnes: 3730, pax: 4200, ratio: 0.89 },
];

it('Sparkline — rend une polyline SVG à partir des points', () => {
  const { container } = render(
    <Sparkline points={[1, 3, 2, 5]} color="#223870" />,
  );
  expect(container.querySelector('polyline')).toBeInTheDocument();
});

it('Sparkline — ne rend rien sous 2 points', () => {
  const { container } = render(<Sparkline points={[1]} color="#223870" />);
  expect(container.querySelector('svg')).toBeNull();
});

it('Sparkline — rend une aire dégradée sous la courbe', () => {
  const { container } = render(
    <Sparkline points={[1, 3, 2, 5]} color="#223870" />,
  );
  // Aire = <polygon> refermé + <linearGradient> de remplissage.
  expect(container.querySelector('polygon')).toBeInTheDocument();
  expect(container.querySelector('linearGradient')).toBeInTheDocument();
});

it('KpiCockpitCard — affiche label, valeur, unité et pastille de variation', () => {
  render(
    <KpiCockpitCard
      label="Tonnage détourné"
      value="48,6"
      unit="t"
      dotColor="#3F5599"
      variationPct={12.4}
      sparkPoints={[1, 2, 3, 5]}
    />,
  );
  expect(screen.getByText('Tonnage détourné')).toBeInTheDocument();
  expect(screen.getByText('48,6')).toBeInTheDocument();
  expect(screen.getByText(/12,4/)).toBeInTheDocument();
});

it('KpiCockpitCard — variation négative affiche ▼ et le pourcentage', () => {
  render(
    <KpiCockpitCard
      label="Marge"
      value="12"
      dotColor="#223870"
      variationPct={-8.3}
    />,
  );
  expect(screen.getByText(/▼\s*8,3\s*%/)).toBeInTheDocument();
});

it('KpiCockpitCard — rend les slots headerRight et footer', () => {
  render(
    <KpiCockpitCard
      label="Marge"
      value="12"
      dotColor="#223870"
      headerRight={<span>aide</span>}
      footer={<span>2 en attente</span>}
    />,
  );
  expect(screen.getByText('aide')).toBeInTheDocument();
  expect(screen.getByText('2 en attente')).toBeInTheDocument();
});

it('KpiCockpitCard — onClick rend un bouton qui déclenche le handler', () => {
  const onClick = vi.fn();
  render(
    <KpiCockpitCard
      label="CO₂ évité"
      value="8 803"
      unit="kg CO₂e"
      dotColor="#16A34A"
      onClick={onClick}
    />,
  );
  const btn = screen.getByRole('button', { name: /CO₂ évité/ });
  fireEvent.click(btn);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('Co2MethodePanel — affiche la méthode + le tableau des facteurs par matière', () => {
  render(
    <Co2MethodePanel
      forfait={{ km: 50, fe_camion: 2.1 }}
      fluxFactors={[
        {
          code: 'biodechet',
          nom: 'Biodéchets',
          fe_evite: 120,
          fe_induit: 30,
          energie: 500,
        },
      ]}
      equivalences={{ km_voiture: 0.218, repas_boeuf: 7, foyer_kwh: 4500 }}
    />,
  );
  expect(
    screen.getByText(/Comment ces chiffres sont-ils calculés/),
  ).toBeInTheDocument();
  // Forfait transport injecté depuis les variables serveur.
  expect(screen.getByText(/50 km/)).toBeInTheDocument();
  // Ligne du tableau des facteurs.
  expect(screen.getByText('Biodéchets')).toBeInTheDocument();
});

it('KpiCockpitCard — href rend un lien cliquable', () => {
  const { container } = render(
    <KpiCockpitCard
      label="X"
      value="1"
      dotColor="#223870"
      href="/traiteur/collectes"
    />,
  );
  expect(
    container.querySelector('a[href="/traiteur/collectes"]'),
  ).toBeInTheDocument();
});

it('EvolutionZdChart — rend des barres + la courbe taux, ou un état vide', () => {
  const { container } = render(
    <EvolutionZdChart series={zd} granularite="mois" />,
  );
  expect(container.querySelectorAll('rect, path').length).toBeGreaterThan(0);
  expect(container.querySelector('polyline')).toBeInTheDocument(); // courbe taux
  expect(
    screen.getByText(/Évolution mensuelle Zéro Déchet/),
  ).toBeInTheDocument();
});

it('EvolutionZdChart — état vide sans série', () => {
  render(<EvolutionZdChart series={[]} granularite="mois" />);
  expect(screen.getByText(/Aucune collecte ZD/)).toBeInTheDocument();
});

it('EvolutionZdChart — légende cliquable présente pour les 5 flux', () => {
  render(<EvolutionZdChart series={zd} granularite="mois" />);
  for (const l of [
    'Biodéchets',
    'Emballages',
    'Cartons',
    'Verre',
    'Déchet résiduel',
  ]) {
    expect(
      screen.getByRole('button', { name: new RegExp(l) }),
    ).toBeInTheDocument();
  }
});

it('EvolutionZdChart — les segments ne portent plus de <title> natif (pas de double tooltip)', () => {
  const { container } = render(
    <EvolutionZdChart series={zd} granularite="mois" />,
  );
  // Le tooltip riche (div) remplace le title SVG natif — sinon double bulle (retour Val).
  expect(container.querySelectorAll('rect > title, path > title').length).toBe(
    0,
  );
});

it('BenchmarkBulletGauges — rend le slot filtres imbriqué', () => {
  render(
    <BenchmarkBulletGauges
      items={[{ label: 'Biodéchets', value: 0.72, benchmark: 0.8 }]}
      filtersSlot={<div>filtres-repère-parc</div>}
    />,
  );
  expect(screen.getByText('filtres-repère-parc')).toBeInTheDocument();
  // Titre de la carte des jauges toujours présent = un seul bloc filtres + jauges.
  expect(screen.getByText(/Intensité par flux/)).toBeInTheDocument();
});

it('EvolutionZdChart — la légende « Taux de recyclage » est un bouton qui masque la courbe', () => {
  const { container } = render(
    <EvolutionZdChart series={zd} granularite="mois" />,
  );
  // Courbe taux présente par défaut (polyline).
  expect(container.querySelector('polyline')).toBeInTheDocument();
  const btn = screen.getByRole('button', { name: /Taux de recyclage/ });
  fireEvent.click(btn);
  // Masquée après clic → plus de polyline.
  expect(container.querySelector('polyline')).toBeNull();
});

it('EvolutionAgChart — la légende Repas/Ratio masque les séries', () => {
  const { container } = render(
    <EvolutionAgChart series={ag} granularite="mois" />,
  );
  // Ratio (polyline) masquable.
  expect(container.querySelector('polyline')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Ratio\/pax/ }));
  expect(container.querySelector('polyline')).toBeNull();
  // Repas (barres <path>) masquables.
  expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: /Repas/ }));
  expect(container.querySelectorAll('path').length).toBe(0);
});

it('TonnagesDonut — rend le total au centre et la légende des 5 flux', () => {
  const { container } = render(<TonnagesDonut series={zd} />);
  expect(container.querySelectorAll('circle').length).toBeGreaterThanOrEqual(5);
  expect(screen.getByText('Biodéchets')).toBeInTheDocument();
});

it('BenchmarkBulletGauges — rend 5 jauges dont un état n<5 (insuffisant)', () => {
  render(
    <BenchmarkBulletGauges
      items={[
        { label: 'Biodéchets', value: 0.72, benchmark: 0.8 },
        { label: 'Emballages', value: 0.31, benchmark: 0.28 },
        { label: 'Carton', value: 0.24, benchmark: 0.17 },
        { label: 'Verre', value: 0.15, benchmark: 0.14 },
        { label: 'Résiduel', value: null, benchmark: null },
      ]}
    />,
  );
  expect(screen.getByText('Biodéchets')).toBeInTheDocument();
  // « Données manquantes » (ex « n < 5 ») figure dans la légende ET sur la jauge
  // insuffisante (Résiduel) — libellés benchmark changés (retour Val).
  expect(
    screen.getAllByText(/Données manquantes/).length,
  ).toBeGreaterThanOrEqual(1);
});

it('Co2HeroCard — met en avant l’évité et affiche induit/net/énergie + équivalences', () => {
  render(
    <Co2HeroCard
      eviteKg={121500}
      induitKg={8200}
      netKg={113300}
      energiePrimaireKwh={486000}
      equivalences={{ kmVoiture: 303750, repasBoeuf: 24300, foyers: 41 }}
    />,
  );
  expect(screen.getByText(/CO₂e évité/)).toBeInTheDocument();
  expect(screen.getByText(/Bilan net/)).toBeInTheDocument();
  expect(screen.getByText(/km en voiture/)).toBeInTheDocument();
});

it('PackAgRing — affiche crédits restants, consommés et badge solde faible', () => {
  render(<PackAgRing creditsInitiaux={20000} creditsRestants={1300} />);
  expect(screen.getByText('1 300')).toBeInTheDocument();
  expect(screen.getByText(/Solde faible/)).toBeInTheDocument();
});

it('PackAgRing — badge « Pack épuisé » à 0', () => {
  render(<PackAgRing creditsInitiaux={20000} creditsRestants={0} />);
  expect(screen.getByText(/Pack épuisé/)).toBeInTheDocument();
});

it('EvolutionAgChart — rend des barres repas + la courbe ratio', () => {
  const { container } = render(
    <EvolutionAgChart series={ag} granularite="mois" />,
  );
  // Barres verticales des repas donnés (path) + courbe ratio (polyline pointillée).
  expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  expect(container.querySelector('polyline')).toBeInTheDocument();
  expect(screen.getByText(/Évolution Anti-Gaspi/)).toBeInTheDocument();
});

it('TopRankList — rend rangs, libellés et valeurs formatées', () => {
  render(
    <TopRankList
      title="Top 5 lieux"
      subtitle="Par tonnage"
      showBar
      items={[
        { label: 'Pavillon Gabriel', value: '14,2 t', barPct: 100 },
        { label: 'Salons Hoche', value: '11,8 t', barPct: 83 },
      ]}
    />,
  );
  expect(screen.getByText('Pavillon Gabriel')).toBeInTheDocument();
  expect(screen.getByText('14,2 t')).toBeInTheDocument();
});

it('EvolutionZdChart — survol d’un segment ouvre le tooltip du flux (grain flux)', () => {
  const { container } = render(
    <EvolutionZdChart series={zd} granularite="mois" />,
  );
  // Aucun tooltip de flux sans survol.
  expect(screen.queryByText(/% du mois/)).toBeNull();
  // Segment « emballage » (#3F5599, non sommet → <rect>) survolé.
  const seg = container.querySelector('rect[fill="#3F5599"]');
  expect(seg).not.toBeNull();
  fireEvent.mouseEnter(seg!);
  expect(screen.getByText(/% du mois/)).toBeInTheDocument();
});

it('EvolutionZdChart — survol de la courbe taux affiche la valeur du mois', () => {
  const { container } = render(
    <EvolutionZdChart series={zd} granularite="mois" />,
  );
  // « Taux de recyclage » n'apparaît qu'une fois (légende) sans survol.
  const before = screen.getAllByText('Taux de recyclage').length;
  const hit = container.querySelector('circle[r="9"]'); // cible de survol de la courbe
  expect(hit).not.toBeNull();
  fireEvent.mouseEnter(hit!);
  // Le tooltip taux s'ajoute (légende + tooltip).
  expect(screen.getAllByText('Taux de recyclage').length).toBe(before + 1);
});

it('BenchmarkBulletGauges — survol d’une jauge affiche Vous/Parc/Écart', () => {
  const { container } = render(
    <BenchmarkBulletGauges
      items={[{ label: 'Biodéchets', value: 0.72, benchmark: 0.8 }]}
    />,
  );
  expect(screen.queryByText('Vous')).toBeNull();
  const gauge = container.querySelector('.relative');
  expect(gauge).not.toBeNull();
  fireEvent.mouseEnter(gauge!);
  expect(screen.getByText('Vous')).toBeInTheDocument();
  expect(screen.getByText('Parc')).toBeInTheDocument();
  expect(screen.getByText('Écart')).toBeInTheDocument();
});

describe('non-régression fmt', () => {
  it('TopRankList vide affiche un état vide', () => {
    render(<TopRankList title="Top" items={[]} />);
    expect(screen.getByText(/Aucune donnée/)).toBeInTheDocument();
  });
});

// ── CO₂ Anti-Gaspi (variante « évité seul » V1 — carte KPI + modale) ─────────
it('Co2HeroCardAg — héros évité seul, sans induit/net/énergie (V1)', () => {
  render(
    <Co2HeroCardAg
      eviteKg={205}
      equivalences={{ kmVoiture: 940, repasBoeuf: 29 }}
    />,
  );
  expect(screen.getByText(/CO₂e évité/)).toBeInTheDocument();
  expect(screen.getByText(/km en voiture/)).toBeInTheDocument();
  expect(screen.getByText(/repas de bœuf/)).toBeInTheDocument();
  // Évité SEUL en V1 : aucune ligne induit / bilan net / énergie primaire.
  expect(screen.queryByText(/Bilan net/)).toBeNull();
  expect(screen.queryByText(/CO₂ induit/)).toBeNull();
  expect(screen.queryByText(/Énergie primaire/)).toBeNull();
});

it('Co2MethodePanelAg — formule par repas + facteur, sans tableau par matière', () => {
  render(
    <Co2MethodePanelAg
      facteurParRepas={2.5}
      source="FAO 2023 — Food loss and waste footprint"
      repasDonnes={82}
      eviteKg={205}
      equivalences={{ km_voiture: 0.218, repas_boeuf: 7 }}
    />,
  );
  expect(
    screen.getByText(/Comment ce chiffre est-il calculé/),
  ).toBeInTheDocument();
  // Formule par repas (méthode FAO) + facteur figé injecté depuis l'endpoint.
  expect(screen.getByText(/82 repas ×/)).toBeInTheDocument();
  expect(screen.getByText(/FAO 2023/)).toBeInTheDocument();
  // Pas de tableau de facteurs par matière (ZD only).
  expect(screen.queryByText(/Facteurs d'émission par matière/)).toBeNull();
});

it('M3.1/dash_cockpit_co2_ag_carte_modale', () => {
  // 1. La carte KPI « CO₂ évité » AG est cliquable (onClick → bouton) → ouvre la
  //    modale (aucune navigation : invariant R24 préservé).
  const onClick = vi.fn();
  const { unmount } = render(
    <KpiCockpitCard
      label="CO₂ évité"
      value="205"
      unit="kg CO₂e"
      dotColor="#16A34A"
      onClick={onClick}
    />,
  );
  const btn = screen.getByRole('button', { name: /CO₂ évité/ });
  fireEvent.click(btn);
  expect(onClick).toHaveBeenCalledTimes(1);
  unmount();

  // 2. Le contenu de la modale AG = héros allégé (évité seul) + méthode par repas.
  render(
    <div>
      <Co2HeroCardAg
        eviteKg={205}
        equivalences={{ kmVoiture: 940, repasBoeuf: 29 }}
      />
      <Co2MethodePanelAg
        facteurParRepas={2.5}
        source="FAO 2023"
        repasDonnes={82}
        eviteKg={205}
        equivalences={{ km_voiture: 0.218, repas_boeuf: 7 }}
      />
    </div>,
  );
  // Héros AG (suréditeur unique) + méthode par repas (chaînes uniques).
  expect(
    screen.getByText(/Impact carbone · dons anti-gaspi/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Comment ce chiffre est-il calculé/),
  ).toBeInTheDocument();
  expect(screen.getByText(/82 repas ×/)).toBeInTheDocument();
  // Rien de la méthode ABC ZD (induit/net/matières) sur l'AG.
  expect(screen.queryByText(/Bilan net/)).toBeNull();
  expect(screen.queryByText(/Facteurs d'émission par matière/)).toBeNull();
});
