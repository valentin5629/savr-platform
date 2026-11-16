// Banc des tests de régression visuelle des rapports (recyclage @4, rapports de
// don @5/@3) : capture d'une page HTML dans Chromium et part des pixels qui
// diffèrent entre le gabarit et sa maquette validée.
//
// Il faut Chromium (celui de Playwright). Sans lui les tests sont sautés, sauf si
// RAPPORT_VISUEL_OBLIGATOIRE=1 : ils échouent alors (job e2e de la CI).
// Exclu du build Docker du renderer (tsconfig : *.test-utils.ts).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';

export const LARGEUR = 794;
export const HAUTEUR = 1122;
// 0,5 % des pixels, un pixel comptant dès qu'un canal s'écarte de plus de 6
// niveaux (le fond des pastilles ne s'écarte du blanc que de 13). Mesuré le
// 2026-11-12 : page 1 avec radar 0,001 %, page 1 jauge 0,000 %, page 2 0,113 %
// (lissage du texte). Sondes détectées : jauge plus basse de 2px 1,9 %, titre de
// l'annexe 1px plus petit 8,8 %. Non détectées, car sous le seuil : pastilles
// élargies de 2px (0,04 %), couleur du texte « Verre » changée. Le test garde la
// mise en page (positions, tailles, blocs) ; une nuance fine reste à l'œil.
export const TOLERANCE = 0.005;

export const chromiumPresent = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
export const visuelObligatoire = process.env.RAPPORT_VISUEL_OBLIGATOIRE === '1';
// Dossier où déposer les captures (gabarit et maquette) pour les regarder.
const DOSSIER_CAPTURES = process.env.RAPPORT_VISUEL_DOSSIER;

let navigateur: Browser | undefined;
let page: Page;

/** Page du navigateur ouvert par `ouvrirNavigateur` (pour les mesures propres à un test). */
export const pageDuBanc = (): Page => page;

export async function ouvrirNavigateur(): Promise<void> {
  if (!chromiumPresent) {
    throw new Error(
      'Chromium de Playwright absent : pnpm exec playwright install chromium',
    );
  }
  // Même rendu du texte que le renderer de production : @sparticuz/chromium
  // lance Chromium avec --font-render-hinting=none. Sans lui, Chromium sous
  // Linux (CI) arrondit les chasses et le texte s'élargit : l'encart passe sur
  // une ligne de plus et la maquette elle-même déborde de la page.
  navigateur = await chromium.launch({ args: ['--font-render-hinting=none'] });
  page = await navigateur.newPage();
}

export async function fermerNavigateur(): Promise<void> {
  await navigateur?.close();
}

export async function capturer(html: string, decalage = 0): Promise<Buffer> {
  await page.setViewportSize({ width: LARGEUR, height: HAUTEUR * 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({
    clip: { x: 0, y: decalage, width: LARGEUR, height: HAUTEUR },
  });
}

/** Écart entre les deux captures ; elles sont déposées si un dossier est donné. */
export async function comparer(
  nom: string,
  gabarit: Buffer,
  maquette: Buffer,
): Promise<number> {
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
