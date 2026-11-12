// Régression visuelle du rapport de recyclage @4 contre les maquettes validées
// par Val (design/rapport-recyclage/2026-11-12-v76/).
//
// Le gabarit et la maquette sont rendus avec les MÊMES valeurs, dans le même
// navigateur, avec les mêmes polices embarquées : seule une différence de
// balisage ou de style peut les séparer. Chaque page est comparée pixel à pixel
// (tolérance : 0,5 % des pixels), puis on vérifie qu'aucune page ne déborde de
// l'A4 sur des données extrêmes.
//
// Il faut Chromium (celui de Playwright). Sans lui le test est sauté, sauf si
// RAPPORT_VISUEL_OBLIGATOIRE=1 : il échoue alors (job e2e de la CI).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CSS_RAPPORT_V4,
  LOGO_DEFS,
  logoSavrComplet,
  renderRapportRecyclageZd,
  type RapportRecyclageZdData,
} from './templates/rapport-recyclage-zd.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const MAQUETTES = path.resolve(
  ICI,
  '../../../design/rapport-recyclage/2026-11-12-v76',
);
const LARGEUR = 794;
const HAUTEUR = 1122;
// 0,5 % des pixels, un pixel comptant dès qu'un canal s'écarte de plus de 6
// niveaux (le fond des pastilles ne s'écarte du blanc que de 13). Mesuré le
// 2026-11-12 : page 1 avec radar 0,001 %, page 1 jauge 0,000 %, page 2 0,113 %
// (lissage du texte). Sondes détectées : jauge plus basse de 2px 1,9 %, titre de
// l'annexe 1px plus petit 8,8 %. Non détectées, car sous le seuil : pastilles
// élargies de 2px (0,04 %), couleur du texte « Verre » changée. Le test garde la
// mise en page (positions, tailles, blocs) ; une nuance fine reste à l'œil.
const TOLERANCE = 0.005;

const chromiumPresent = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
const obligatoire = process.env.RAPPORT_VISUEL_OBLIGATOIRE === '1';
// Dossier où déposer les captures (gabarit et maquette) pour les regarder.
const DOSSIER_CAPTURES = process.env.RAPPORT_VISUEL_DOSSIER;

/** Écart entre les deux captures ; elles sont déposées si un dossier est donné. */
async function comparer(nom: string, gabarit: Buffer, maquette: Buffer) {
  const { part: e, carte } = await ecart(gabarit, maquette);
  if (DOSSIER_CAPTURES) {
    mkdirSync(DOSSIER_CAPTURES, { recursive: true });
    writeFileSync(
      path.join(DOSSIER_CAPTURES, `${nom}-ecart.png`),
      Buffer.from(carte.split(',')[1] as string, 'base64'),
    );
    writeFileSync(path.join(DOSSIER_CAPTURES, `${nom}-gabarit.png`), gabarit);
    writeFileSync(path.join(DOSSIER_CAPTURES, `${nom}-maquette.png`), maquette);
    writeFileSync(
      path.join(DOSSIER_CAPTURES, `${nom}-ecart.txt`),
      `${(e * 100).toFixed(3)} %\n`,
    );
  }
  return e;
}

// ── Données de la maquette ───────────────────────────────────────────────────
const LOGO_CLIENT =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 40"><rect width="96" height="40" rx="6" fill="#ff7900"/><text x="48" y="27" font-size="18" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">CLIENT</text></svg>',
  ).toString('base64');
const LOGO_TRAITEUR =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="44" fill="#223870"/><text x="48" y="55" font-size="18" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">TRAIT.</text></svg>',
  ).toString('base64');

const REFERENTIEL = {
  emballage: {
    code_dechet_europeen: '15 01 06',
    exutoire: 'CENTRE DE TRI SELECTIF PAPREC TRIVALO 93',
    exutoire_commune: 'Le Blanc-Mesnil',
    code_traitement: 'R3/R5',
    filiere_valorisation: 'recyclage',
  },
  biodechet: {
    code_dechet_europeen: '20 01 08',
    exutoire: 'GENERIS VSG DCDT',
    exutoire_commune: 'Villeneuve-Saint-Georges',
    code_traitement: 'R3',
    filiere_valorisation: 'methanisation',
  },
  verre: {
    code_dechet_europeen: '15 01 07',
    exutoire: 'REVIVAL GENNEVILLIERS TRSFT',
    exutoire_commune: 'Gennevilliers',
    code_traitement: 'R5',
    filiere_valorisation: 'recyclage',
  },
  carton: {
    code_dechet_europeen: '15 01 01',
    exutoire: 'TAIS VILLENEUVE LE ROI TDI',
    exutoire_commune: 'Villeneuve-le-Roi',
    code_traitement: 'R3',
    filiere_valorisation: 'recyclage',
  },
  dechet_residuel: {
    code_dechet_europeen: '20 03 01',
    exutoire: 'NOVAZUR ARGENTEUIL UVEND',
    exutoire_commune: 'Argenteuil',
    code_traitement: 'R1',
    filiere_valorisation: 'valorisation_energetique',
  },
} as const;

const POIDS = {
  emballage: 74,
  biodechet: 255,
  verre: 190,
  carton: 110,
  dechet_residuel: 196,
} as const;
const PAX = 2300;
const MOYENNES = {
  biodechet: 0.095,
  emballage: 0.04,
  carton: 0.055,
  verre: 0.07,
  dechet_residuel: 0.12,
} as const;
const NOMS: Record<string, string> = {
  emballage: 'Emballages',
  biodechet: 'Biodéchets',
  verre: 'Verre',
  carton: 'Cartons',
  dechet_residuel: 'Déchet résiduel',
};

function donneesMaquette(
  over: Partial<RapportRecyclageZdData> = {},
): RapportRecyclageZdData {
  const codes = Object.keys(POIDS) as (keyof typeof POIDS)[];
  return {
    nom_evenement: 'Soirée annuelle Orange',
    date_evenement: '18/03/2025',
    lieu_nom: 'CNIT, La Défense',
    nb_pax: PAX,
    logo_client_url: LOGO_CLIENT,
    logo_traiteur_url: LOGO_TRAITEUR,
    // 540,65 kg recyclés sur 825 kg (Σ poids × captation) : 65,5 % affiché, 541 kg.
    taux_recyclage: 65.53,
    flux: codes.map((c) => ({
      nom: NOMS[c] as string,
      code: c,
      poids_kg: POIDS[c],
      ...REFERENTIEL[c],
    })),
    poids_total_kg: 825,
    co2_evite_kg: 374,
    co2_induit_kg: 411,
    energie_primaire_evitee_kwh: 927,
    equivalences: { km_voiture: 1460 },
    forfait_transport: { km: 25, fe_camion_kg_km: 0.4 },
    caps_appliques: {
      verre: 0.95,
      carton: 0.9,
      biodechet: 0.85,
      emballage: 0.6,
    },
    bordereau_numero: 'BSAV-2025-00042',
    bordereau_date_emission: '19/03/2025',
    options: { benchmark: true },
    benchmark_flux: codes.map((c) => ({
      flux_code: c,
      flux_nom: NOMS[c] as string,
      collecte_kg_pax: POIDS[c] / PAX,
      benchmark_kg_pax: MOYENNES[c],
    })),
    benchmark_effectif: 128,
    benchmark_criteres: 'taille XL, cocktail repas complet',
    ...over,
  };
}

// ── Maquette rendue avec les mêmes valeurs ───────────────────────────────────
const POLICES = CSS_RAPPORT_V4.split('\n')
  .filter((l) => l.startsWith('@font-face'))
  .join('\n');

/** Logos et valeurs de la maquette remplacés par ceux que rend le gabarit. */
function maquetteRendue(
  fichier: string,
  html: string,
  remplacements: [string | RegExp, string][],
): string {
  const source = readFileSync(path.join(MAQUETTES, fichier), 'utf8');
  const helmet = (/<helmet>([\s\S]*?)<\/helmet>/.exec(source)?.[1] ?? '')
    .replace(/<link[^>]*>/g, '')
    .replace('height:1123px', `height:${HAUTEUR}px`);
  const corps =
    /<\/helmet>([\s\S]*?)<\/x-dc>/.exec(source)?.[1] ?? 'MAQUETTE ILLISIBLE';
  let page = corps
    .replaceAll('{{navy}}', '#223870')
    .replace(/height: ?1123px/g, (m) => m.replace('1123', String(HAUTEUR)))
    .replace(
      /<img src="\/_blob\/4681284c26985cc515256e83c36b8133" alt="Savr" style="([^"]*)">/g,
      (_, style: string) => {
        const w = Number(/width: ?(\d+)px/.exec(style)?.[1]);
        const h = Number(/height: ?(\d+)px/.exec(style)?.[1]);
        const reste = style
          .replace(/width: ?\d+px;? ?/, '')
          .replace(/height: ?\d+px;? ?/, '');
        return logoSavrComplet(w, h, reste);
      },
    );
  // Emplacements de logos de la maquette → boîtes rendues par le gabarit.
  const logos =
    /(<div style="position: absolute; right: 0; top: 0; display: flex; gap: 10px;">.*?<\/div>)\n/.exec(
      html,
    )?.[1];
  page = page.replace(
    /<div style="position: absolute; right: 0; top: 0; display: flex; gap: 10px;">.*?\[Logo traiteur\]<\/div><\/div>/,
    logos ?? '',
  );
  for (const [de, vers] of remplacements) page = page.replace(de, vers);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${POLICES}</style>${helmet}</head><body>${LOGO_DEFS}${page}</body></html>`;
}

const tbd = (valeur: string): [RegExp, string] => [
  /<span class="tbd">[^<]*<\/span>/,
  valeur,
];

// ── Navigateur ───────────────────────────────────────────────────────────────
let navigateur: Browser;
let page: Page;

async function capturer(html: string, decalage = 0): Promise<Buffer> {
  await page.setViewportSize({ width: LARGEUR, height: HAUTEUR * 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({
    clip: { x: 0, y: decalage, width: LARGEUR, height: HAUTEUR },
  });
}

/**
 * Part des pixels dont un canal s'écarte de plus de 6 niveaux, et carte de ces
 * pixels (PNG en data URI, rouge sur la capture du gabarit pâlie).
 */
async function ecart(
  a: Buffer,
  b: Buffer,
): Promise<{ part: number; carte: string }> {
  return page.evaluate(
    async ([ua, ub]) => {
      const charger = async (src: string) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [da, db] = await Promise.all([charger(ua), charger(ub)]);
      const c = document.createElement('canvas');
      c.width = 794;
      c.height = da.length / 4 / 794;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      const carte = ctx.createImageData(c.width, c.height);
      let diff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const different =
          Math.abs(da[i] - db[i]) > 6 ||
          Math.abs(da[i + 1] - db[i + 1]) > 6 ||
          Math.abs(da[i + 2] - db[i + 2]) > 6;
        if (different) diff++;
        carte.data[i] = different ? 255 : 255 - (255 - da[i]) / 4;
        carte.data[i + 1] = different ? 0 : 255 - (255 - da[i + 1]) / 4;
        carte.data[i + 2] = different ? 0 : 255 - (255 - da[i + 2]) / 4;
        carte.data[i + 3] = 255;
      }
      ctx.putImageData(carte, 0, 0);
      return { part: diff / (da.length / 4), carte: c.toDataURL('image/png') };
    },
    [
      `data:image/png;base64,${a.toString('base64')}`,
      `data:image/png;base64,${b.toString('base64')}`,
    ] as const,
  );
}

/**
 * Par page : fin du contenu (encart Savr, dernier bloc, avec sa marge), bas de
 * l'encart et bord droit du contenu. La hauteur de la page ne dit rien : elle
 * est fixée à 1122px et coupe ce qui dépasse.
 */
async function mesurer(html: string) {
  await page.setViewportSize({ width: LARGEUR, height: HAUTEUR });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.pg-1, .pg')].map((pg) => {
      const haut = pg.getBoundingClientRect().top;
      const encart = pg.querySelector(
        'section[aria-label="Présentation de Savr"]',
      ) as HTMLElement;
      let large = 0;
      pg.querySelectorAll(
        'main *, header > div *, header > p, header > h1',
      ).forEach((el) => {
        large = Math.max(large, el.getBoundingClientRect().right);
      });
      const main = pg.querySelector('main') as HTMLElement;
      // Bas de l'encart + sa marge + le retrait du bas de <main> : là où le
      // contenu s'arrête ; il doit rester dans la page.
      const fin =
        encart.getBoundingClientRect().bottom -
        haut +
        parseFloat(getComputedStyle(encart).marginBottom) +
        parseFloat(getComputedStyle(main).paddingBottom);
      return {
        fin,
        encartBas: encart.getBoundingClientRect().bottom - haut,
        large,
      };
    }),
  );
}

const suite = chromiumPresent || obligatoire ? describe : describe.skip;

suite(
  'M1.6 / rapport de recyclage @4 — identique aux maquettes validées (régression visuelle)',
  () => {
    beforeAll(async () => {
      if (!chromiumPresent) {
        throw new Error(
          'Chromium de Playwright absent : pnpm exec playwright install chromium',
        );
      }
      // Même rendu du texte que le renderer de production : @sparticuz/chromium
      // lance Chromium avec --font-render-hinting=none. Sans lui, Chromium sous
      // Linux (CI) arrondit les chasses et le texte s'élargit : l'encart passe sur
      // une ligne de plus et la maquette elle-même déborde de la page.
      navigateur = await chromium.launch({
        args: ['--font-render-hinting=none'],
      });
      page = await navigateur.newPage();
    }, 60_000);
    afterAll(async () => {
      await navigateur?.close();
    });

    it('page 1 avec radar = RapportPage1 (écart ≤ 0,5 %)', async () => {
      const html = renderRapportRecyclageZd(donneesMaquette());
      const gabarit = await capturer(html, 0);
      // Le polygone « Votre collecte » et ses points sont des valeurs : la maquette
      // les avait placés à la main (valeurs approchées), le gabarit les calcule.
      const vous =
        /<polygon points="[^"]*" fill="#ffd699"[\s\S]*?<g font-family/.exec(
          html,
        )?.[0] ?? '';
      const maquette = await capturer(
        maquetteRendue('RapportPage1.dc.html', html, [
          [
            /<polygon points="[^"]*" fill="#ffd699"[\s\S]*?<g font-family/,
            vous,
          ],
        ]),
      );
      expect(
        await comparer('page1-radar', gabarit, maquette),
      ).toBeLessThanOrEqual(TOLERANCE);
    }, 60_000);

    it('page 1 sans radar = RapportJauge (écart ≤ 0,5 %)', async () => {
      const html = renderRapportRecyclageZd(
        donneesMaquette({ options: { benchmark: false } }),
      );
      const gabarit = await capturer(html, 0);
      const maquette = await capturer(
        maquetteRendue('RapportJauge.dc.html', html, []),
      );
      expect(
        await comparer('page1-jauge', gabarit, maquette),
      ).toBeLessThanOrEqual(TOLERANCE);
    }, 60_000);

    it('page 2 = RapportPage2, valeurs posées dans les emplacements (écart ≤ 0,5 %)', async () => {
      // Le texte de l'emplacement de la maquette, tel quel : les noms réels du
      // référentiel, plus longs, font déborder la maquette elle-même ; ils sont
      // éprouvés par les tests de débordement ci-dessous.
      const base = donneesMaquette();
      const html = renderRapportRecyclageZd({
        ...base,
        flux: base.flux.map((f) => ({
          ...f,
          exutoire: '[Exutoire',
          exutoire_commune: 'commune]',
        })),
      });
      const gabarit = await capturer(html, HAUTEUR);
      const ordre = [1, 2, 3, 4, 5];
      const maquette = await capturer(
        maquetteRendue('RapportPage2.dc.html', html, [
          tbd('BSAV-2025-00042'),
          tbd('19/03/2025'),
          ...ordre.map(() => tbd('[Exutoire, commune]')),
          // Écarts voulus (C4, README des maquettes) et effectif en collectes.
          ['<th>Exutoire</th>', '<th>Exutoire habituel</th>'],
          ['R3/R4 recyclage', 'R3/R5 recyclage'],
          [/<span class="tbd">\[n\]<\/span> événements/, '128 collectes'],
          tbd('taille XL, cocktail repas complet'),
        ]),
      );
      expect(
        await comparer('page2-annexe', gabarit, maquette),
      ).toBeLessThanOrEqual(TOLERANCE);
    }, 60_000);

    // ── Débordement A4 : l'encart Savr, dernier bloc des deux pages, garde sa
    //    marge de 34px sous lui, et aucune page ne dépasse 1122px ──────────────
    const seulBiodechets = (
      d: RapportRecyclageZdData,
    ): RapportRecyclageZdData => ({
      ...d,
      flux: d.flux.filter((f) => f.code === 'biodechet'),
      poids_total_kg: 255,
      taux_recyclage: 85,
    });
    const cas: [string, RapportRecyclageZdData][] = [
      [
        'valeurs de la maquette, exutoires réels du référentiel',
        donneesMaquette(),
      ],
      [
        'nom d’événement très long',
        donneesMaquette({
          nom_evenement:
            'Convention annuelle des directeurs régionaux et de leurs équipes commerciales — édition anniversaire des vingt-cinq ans',
        }),
      ],
      [
        'lieu long',
        donneesMaquette({
          lieu_nom:
            'Palais des congrès de la Porte Maillot, niveau 3, salons panoramiques Neuilly et Ternes',
        }),
      ],
      [
        'un seul flux pesé, les autres à 0 kg',
        seulBiodechets(donneesMaquette()),
      ],
      [
        'gros tonnages',
        donneesMaquette({
          flux: donneesMaquette().flux.map((f) => ({
            ...f,
            poids_kg: f.poids_kg * 137.3,
          })),
          poids_total_kg: 825 * 137.3,
          nb_pax: 98_500,
          co2_evite_kg: 51_350,
          co2_induit_kg: 56_430,
          energie_primaire_evitee_kwh: 127_271,
          equivalences: { km_voiture: 235_550 },
          benchmark_effectif: 12_480,
        }),
      ],
      [
        'sans logos',
        donneesMaquette({ logo_client_url: null, logo_traiteur_url: null }),
      ],
      [
        'radar sans repère pour deux flux (k-anonymat)',
        donneesMaquette({
          benchmark_flux: donneesMaquette().benchmark_flux?.map((g) =>
            g.flux_code === 'verre' || g.flux_code === 'carton'
              ? { ...g, benchmark_kg_pax: null }
              : g,
          ),
        }),
      ],
      [
        'tous les cas extrêmes à la fois',
        seulBiodechets(
          donneesMaquette({
            nom_evenement:
              'Convention annuelle des directeurs régionaux et de leurs équipes commerciales — édition anniversaire des vingt-cinq ans',
            lieu_nom:
              'Palais des congrès de la Porte Maillot, niveau 3, salons panoramiques Neuilly et Ternes',
            logo_client_url: null,
            // Le plus long que fabrique rapport-radar.ts : toutes les tailles, tous
            // les types, une sélection de lieux.
            benchmark_criteres:
              'taille XS/S/M/L/XL, cocktail apéritif, cocktail repas complet, repas assis, autre, 12 lieux',
          }),
        ),
      ],
    ];
    for (const [nom, donnees] of cas) {
      for (const radar of [true, false]) {
        it(`débordement A4 — ${nom} (${radar ? 'avec' : 'sans'} radar)`, async () => {
          const pages = await mesurer(
            renderRapportRecyclageZd({
              ...donnees,
              options: { benchmark: radar },
            }),
          );
          expect(pages).toHaveLength(2);
          for (const p of pages) {
            expect(p.fin).toBeLessThanOrEqual(HAUTEUR + 0.5);
            // L'encart garde au moins ~34px de blanc sous lui (34,5 avec radar).
            expect(p.encartBas).toBeLessThanOrEqual(HAUTEUR - 34 + 0.5);
            expect(p.large).toBeLessThanOrEqual(LARGEUR);
          }
        }, 60_000);
      }
    }
  },
);
