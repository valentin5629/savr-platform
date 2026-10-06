/**
 * R24 — smoke tests de la librairie data-viz « Cockpit » (rendu + contenu clé).
 * Composants présentationnels : on vérifie qu'ils rendent sans crash et
 * exposent leurs valeurs/structures signature (SVG, chiffres FR, états).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type {
  FluxSeriePoint,
  RepasSeriePoint,
} from '@/components/dashboards/useEvolutionBlocs';
import { Sparkline } from '@/components/ui/sparkline';
import { StatCard } from '@/components/ui/stat-card';
import { EvolutionZdChart } from './EvolutionZdChart';
import { TonnagesDonut } from './TonnagesDonut';
import { BenchmarkRadar } from './BenchmarkRadar';
import { Co2HeroCard } from './Co2HeroCard';
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

it('StatCard — affiche label, valeur, unité et pastille de variation', () => {
  render(
    <StatCard
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

it('StatCard — variation négative affiche ▼ et le pourcentage', () => {
  render(
    <StatCard
      label="Marge"
      value="12"
      dotColor="#223870"
      variationPct={-8.3}
    />,
  );
  expect(screen.getByText(/▼\s*8,3\s*%/)).toBeInTheDocument();
});

it('StatCard — rend les slots headerRight et footer', () => {
  render(
    <StatCard
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

it('StatCard — onClick rend un bouton qui déclenche le handler', () => {
  const onClick = vi.fn();
  render(
    <StatCard
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
  // Ligne du tableau des facteurs — primitive Table du DS (R-UI-4b) :
  // sémantique table / columnheader / cell conservée.
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
  expect(
    within(table).getByRole('cell', { name: 'Biodéchets' }),
  ).toBeInTheDocument();
});

it('StatCard — href rend un lien cliquable', () => {
  const { container } = render(
    <StatCard
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
    'Carton',
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

it('BenchmarkRadar — rend le slot filtres imbriqué', () => {
  render(
    <BenchmarkRadar
      items={[{ label: 'Biodéchets', value: 0.72, benchmark: 0.8 }]}
      filtersSlot={<div>filtres-repère-parc</div>}
    />,
  );
  expect(screen.getByText('filtres-repère-parc')).toBeInTheDocument();
  // Titre de la carte toujours présent = un seul bloc filtres + radar.
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
  // Total au centre = somme des 5 flux sur les 2 périodes (9 170 + 10 410 =
  // 19 580 kg), basculée en tonnes au-delà de 10 000 kg (§11) : « 19,6 t ».
  expect(
    screen.getByLabelText('Répartition des tonnages, total 19,6 t'),
  ).toBeInTheDocument();
  expect(screen.getByText('19,6')).toBeInTheDocument();
  expect(screen.getByText('tonnes')).toBeInTheDocument();
});

it('TonnagesDonut — sans pesée : « — » au centre et mention « aucune pesée »', () => {
  render(<TonnagesDonut series={[]} />);
  expect(screen.getByText('aucune pesée')).toBeInTheDocument();
  expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
});

it('EvolutionAgChart — sans série : état vide explicite', () => {
  render(<EvolutionAgChart series={[]} granularite="mois" />);
  expect(
    screen.getByText('Aucune collecte Anti-Gaspi sur la période.'),
  ).toBeInTheDocument();
});

it('BenchmarkRadar — rend 5 axes dont un état insuffisant (données manquantes)', () => {
  const { getByTestId } = render(
    <BenchmarkRadar
      items={[
        { label: 'Biodéchets', value: 0.72, benchmark: 0.8 },
        { label: 'Emballages', value: 0.31, benchmark: 0.28 },
        { label: 'Carton', value: 0.24, benchmark: 0.17 },
        { label: 'Verre', value: 0.15, benchmark: 0.14 },
        { label: 'Résiduel', value: null, benchmark: null },
      ]}
    />,
  );
  for (let i = 0; i < 5; i++)
    expect(getByTestId(`benchmark-radar-axe-${i}`)).toBeInTheDocument();
  expect(screen.queryByTestId('benchmark-radar-axe-5')).toBeNull();
  // « Données manquantes » dans la LIGNE du flux insuffisant (pas la légende).
  const lignes = screen.getAllByTestId('benchmark-radar-ligne');
  expect(lignes).toHaveLength(5);
  expect(lignes[4]!.textContent).toContain('Données manquantes');
  expect(lignes[0]!.textContent).not.toContain('Données manquantes');
  // L'axe insuffisant porte « n/d » (2e ligne du libellé).
  expect(getByTestId('benchmark-radar-axe-4').textContent).toContain('n/d');
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

it('EvolutionAgChart — survol : point emphasé, aucune bande pleine colonne (retour Val)', () => {
  const { container } = render(
    <EvolutionAgChart series={ag} granularite="mois" />,
  );
  // Aucune surbrillance pleine colonne AVANT survol.
  expect(container.querySelector('rect[opacity="0.04"]')).toBeNull();
  const zone = container.querySelector('rect[fill="transparent"]');
  expect(zone).not.toBeNull();
  fireEvent.mouseEnter(zone!);
  // Toujours aucune bande colonne APRÈS survol — seul le point/la barre s'emphase.
  expect(container.querySelector('rect[opacity="0.04"]')).toBeNull();
  // Le point de ratio du créneau survolé s'agrandit (r 1.25 → 2.75).
  expect(container.querySelector('circle[r="2.75"]')).not.toBeNull();
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

it('TopRankList — onItemClick : lignes cliquables, index transmis (drill-down)', () => {
  const onItemClick = vi.fn();
  render(
    <TopRankList
      title="Top 5 lieux"
      items={[
        { label: 'Pavillon Gabriel', value: '14,2 t' },
        { label: 'Salons Hoche', value: '11,8 t' },
      ]}
      onItemClick={onItemClick}
    />,
  );
  const btns = screen.getAllByRole('button', { name: /Voir les collectes/ });
  expect(btns).toHaveLength(2);
  fireEvent.click(btns[1]!);
  expect(onItemClick).toHaveBeenCalledWith(1);
});

it('TopRankList — sans onItemClick : aucune ligne cliquable', () => {
  render(<TopRankList title="Top" items={[{ label: 'X', value: '1' }]} />);
  expect(
    screen.queryByRole('button', { name: /Voir les collectes/ }),
  ).toBeNull();
});

it('EvolutionZdChart — survol d’un segment ouvre le tooltip du flux (grain flux)', () => {
  const { container } = render(
    <EvolutionZdChart series={zd} granularite="mois" />,
  );
  // Aucun tooltip de flux sans survol.
  expect(screen.queryByText(/% du mois/)).toBeNull();
  // Segment « emballage » (token dataviz-3, non sommet → <rect>) survolé.
  const seg = container.querySelector(
    'rect[fill="var(--color-savr-dataviz-3)"]',
  );
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

it('BenchmarkRadar — survol d’un axe affiche Vous/Parc/Écart', () => {
  const { getByTestId } = render(
    <BenchmarkRadar
      items={[{ label: 'Biodéchets', value: 0.72, benchmark: 0.8 }]}
    />,
  );
  expect(screen.queryByTestId('benchmark-radar-tooltip')).toBeNull();
  // jsdom : rect nul → coordonnées en unités viewBox (centre 230,145).
  fireEvent.mouseMove(getByTestId('benchmark-radar'), {
    clientX: 230,
    clientY: 60,
  });
  const tip = screen.getByTestId('benchmark-radar-tooltip');
  expect(tip.textContent).toContain('Vous');
  expect(tip.textContent).toContain('Parc');
  expect(tip.textContent).toContain('Écart');
  expect(tip.textContent).toContain('−10\u00a0%'); // fmtPct : espace insécable avant %
  fireEvent.mouseLeave(getByTestId('benchmark-radar'));
  expect(screen.queryByTestId('benchmark-radar-tooltip')).toBeNull();
});

it('BenchmarkRadar — survol n’importe où sur le radar : l’axe le plus proche du curseur est retenu', () => {
  const items = ['A', 'B', 'C', 'D', 'E'].map((label, k) => ({
    label,
    value: 0.1 + k / 100,
    benchmark: 0.1,
  }));
  const { getByTestId } = render(<BenchmarkRadar items={items} />);
  const svg = getByTestId('benchmark-radar');
  // Bas-gauche du centre (angle ≈ 126°) → axe D (index 3, en bas à gauche).
  fireEvent.mouseMove(svg, { clientX: 230 - 40, clientY: 145 + 55 });
  expect(screen.getByTestId('benchmark-radar-tooltip').textContent).toMatch(
    /^D/,
  );
  // Droite du centre (angle ≈ 0°) → axe B (index 1, à droite).
  fireEvent.mouseMove(svg, { clientX: 230 + 80, clientY: 145 - 20 });
  expect(screen.getByTestId('benchmark-radar-tooltip').textContent).toMatch(
    /^B/,
  );
  // Le repère parc de l'axe survolé est matérialisé.
  expect(screen.getByTestId('benchmark-radar-point-parc')).toBeInTheDocument();
});

it('BenchmarkRadar — survol d’une ligne de liste : axe mis en évidence, sans infobulle en double', () => {
  render(
    <BenchmarkRadar
      items={[
        { label: 'A', value: 0.1, benchmark: 0.1 },
        { label: 'B', value: 0.1, benchmark: 0.1 },
        { label: 'C', value: 0.1, benchmark: 0.1 },
      ]}
    />,
  );
  fireEvent.mouseEnter(screen.getAllByTestId('benchmark-radar-ligne')[1]!);
  expect(screen.queryByTestId('benchmark-radar-tooltip')).toBeNull();
  expect(screen.getByTestId('benchmark-radar-point-parc')).toBeInTheDocument();
});

it('BenchmarkRadar — indice parc = 100 : chaque flux a sa valeur, son repère et son écart ; flux manquant = n/d sans point', () => {
  const { container, getByTestId } = render(
    <BenchmarkRadar
      items={[
        { label: 'Biodéchets', value: 0.12, benchmark: 0.12 },
        { label: 'Emballages', value: 0.05, benchmark: 0.05 },
        { label: 'Cartons', value: 0.08, benchmark: 0.08 },
        { label: 'Verre', value: 0.0404, benchmark: 0.04 },
        { label: 'Déchet résiduel', value: null, benchmark: 0.18 },
      ]}
    />,
  );
  // 4 sommets « Vous » seulement : le flux sans valeur n'a pas de point.
  expect(container.querySelectorAll('svg circle').length).toBe(4);
  expect(getByTestId('benchmark-radar-axe-4').textContent).toBe(
    'Déchet résiduel' + 'n/d',
  );
  // Les valeurs réelles restent lisibles (liste), avec l'écart en badge.
  expect(screen.getByText('+1 %')).toBeInTheDocument();
  expect(screen.getByText(/0,12 kg\/pax · parc 0,12/)).toBeInTheDocument();
});

it('BenchmarkRadar — seuils du badge : ≤ parc vert, ≤ +30 % orange, au-delà rouge', () => {
  render(
    <BenchmarkRadar
      items={[
        { label: 'A', value: 0.1, benchmark: 0.1 },
        { label: 'B', value: 0.13, benchmark: 0.1 },
        { label: 'C', value: 0.14, benchmark: 0.1 },
      ]}
    />,
  );
  const [a, b, c] = screen.getAllByTestId('benchmark-radar-ligne');
  const couleur = (li: HTMLElement, txt: string) =>
    (li.querySelector('span[style]') as HTMLElement | null)?.textContent === txt
      ? (li.querySelector('span[style]') as HTMLElement).style.color
      : 'absent';
  // Couleurs = tokens DS (R-UI-6a) : le style inline porte la référence var().
  expect(couleur(a!, '+0\u00a0%')).toBe('var(--color-savr-success)');
  expect(couleur(b!, '+30\u00a0%')).toBe('var(--color-savr-accent-700)');
  expect(couleur(c!, '+40\u00a0%')).toBe('var(--color-savr-error)');
});

it('BenchmarkRadar — parc à 0 ou NaN : axe n/d partout (jamais « +∞ % » / « NaN »), le reste du radar intact', () => {
  const { container, getByTestId } = render(
    <BenchmarkRadar
      items={[
        { label: 'A', value: 0.1, benchmark: 0 },
        { label: 'B', value: Number.NaN, benchmark: 0.1 },
        { label: 'C', value: 0.1, benchmark: 0.1 },
        { label: 'D', value: 0.1, benchmark: 0.1 },
      ]}
    />,
  );
  const texte = container.textContent ?? '';
  expect(texte).not.toMatch(/∞|NaN/);
  expect(getByTestId('benchmark-radar-axe-0').textContent).toContain('n/d');
  expect(getByTestId('benchmark-radar-axe-1').textContent).toContain('n/d');
  const lignes = screen.getAllByTestId('benchmark-radar-ligne');
  expect(lignes[0]!.textContent).toContain('Données manquantes');
  expect(lignes[1]!.textContent).toContain('Données manquantes');
  // Les anneaux de grille restent calculables (un NaN ne contamine pas l'échelle).
  const polys = Array.from(container.querySelectorAll('svg polygon'));
  expect(polys.length).toBeGreaterThan(0);
  for (const p of polys) expect(p.getAttribute('points')).not.toMatch(/NaN/);
  expect(container.querySelectorAll('svg circle').length).toBe(2);
});

it("BenchmarkRadar — une valeur ×10 est plafonnée au bord (anneau 300), l'écart exact reste dans la liste", () => {
  const { container } = render(
    <BenchmarkRadar
      items={[
        { label: 'A', value: 1, benchmark: 0.1 },
        { label: 'B', value: 0.1, benchmark: 0.1 },
        { label: 'C', value: 0.1, benchmark: 0.1 },
      ]}
    />,
  );
  // Point A (axe du haut) posé sur l'anneau extérieur : cy = CY − R = 45.
  const cy = Number(container.querySelector('svg circle')!.getAttribute('cy'));
  expect(cy).toBeCloseTo(45, 5);
  // Échelle plafonnée à 300 : 6 anneaux (50 → 300), pas 20 (50 → 1000).
  expect(container.querySelectorAll('svg polygon').length).toBe(6);
  expect(screen.getByText('+900 %')).toBeInTheDocument();
});

it('BenchmarkRadar — liste vide : rend la carte sans planter', () => {
  render(<BenchmarkRadar items={[]} />);
  expect(screen.getByText(/Intensité par flux/)).toBeInTheDocument();
  expect(screen.queryAllByTestId('benchmark-radar-ligne')).toHaveLength(0);
});

describe('non-régression fmt', () => {
  it('TopRankList vide affiche un état vide', () => {
    render(<TopRankList title="Top" items={[]} />);
    expect(screen.getByText(/Aucune donnée/)).toBeInTheDocument();
  });
});

// ── CO₂ Anti-Gaspi (variante « évité seul » V1 — carte KPI + modale) ─────────
it('Co2HeroCard variant="ag" — héros évité seul, sans induit/net/énergie (V1)', () => {
  render(
    <Co2HeroCard
      variant="ag"
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

it('Co2 AG — carte cliquable + contenu modale (composants isolés)', () => {
  // 1. La carte KPI « CO₂ évité » AG est cliquable (onClick → bouton) → ouvre la
  //    modale (aucune navigation : invariant R24 préservé).
  const onClick = vi.fn();
  const { unmount } = render(
    <StatCard
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
      <Co2HeroCard
        variant="ag"
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
