// Parties pures du harnais de charge k6 (tests/load). Les runs eux-mêmes ne
// passent pas ici : ils demandent k6 et une cible vivante (README).
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { dureeEnMs, entetes, hoteAutorise, lireConfig } from './config.js';
import { compteDuVu, COMPTES_TRAITEUR, TRAITEURS } from './comptes.js';
import { SLA, seuilsK6 } from './seuils.js';
import { tranche, verdictDegradation } from './endurance.js';

const BASE = {
  BASE_URL: 'https://dev.app.gosavr.io',
  MOT_DE_PASSE: 'x',
  PROTECTION_BYPASS: 'y',
};

describe('charge — cible du run', () => {
  it.each([
    'app.gosavr.io',
    'savr-platform-git-main-savr-s-projects.vercel.app',
    'savr-platform-savr-s-projects.vercel.app',
    'exemple.com',
  ])('refuse %s (production ou inconnu)', (hote) => {
    expect(hoteAutorise(hote)).toBe(false);
    expect(() => lireConfig({ ...BASE, BASE_URL: `https://${hote}` })).toThrow(
      /Hôte refusé/,
    );
  });

  it.each([
    'dev.app.gosavr.io',
    'savr-platform-git-dev-savr-s-projects.vercel.app',
    'savr-platform-git-perf-tests-de-charge-k6-savr-s-projects.vercel.app',
    'localhost',
  ])('accepte %s', (hote) => {
    expect(hoteAutorise(hote)).toBe(true);
  });

  it('exige une cible explicite, le mot de passe et, hors local, le contournement Vercel', () => {
    expect(() => lireConfig({ ...BASE, BASE_URL: undefined })).toThrow(
      /BASE_URL manquante/,
    );
    expect(() => lireConfig({ ...BASE, MOT_DE_PASSE: '' })).toThrow(
      /MOT_DE_PASSE/,
    );
    expect(() => lireConfig({ ...BASE, PROTECTION_BYPASS: '' })).toThrow(
      /PROTECTION_BYPASS/,
    );
    expect(
      lireConfig({
        BASE_URL: 'http://localhost:3001',
        MOT_DE_PASSE: 'x',
      }).baseUrl,
    ).toBe('http://localhost:3001');
  });

  it("met le contournement en en-tête, jamais dans l'URL", () => {
    const cfg = lireConfig(BASE);
    expect(cfg.baseUrl).toBe('https://dev.app.gosavr.io');
    expect(entetes(cfg)).toEqual({ 'x-vercel-protection-bypass': 'y' });
  });

  it('lit les durées au format k6', () => {
    expect(dureeEnMs('90s')).toBe(90_000);
    expect(dureeEnMs('30m')).toBe(1_800_000);
    expect(dureeEnMs('24h')).toBe(86_400_000);
    expect(() => dureeEnMs('1j')).toThrow(/illisible/);
  });
});

describe('charge — seuils recopiés du CDC', () => {
  const doc = readFileSync(
    path.resolve(
      __dirname,
      '../../../specs/cdc/01 - Cahier des charges App/08 - Performance/02 - SLA par endpoint.md',
    ),
    'utf8',
  );

  // « 200 ms » → 200 ; « 2 s » → 2000 ; « 5 s end-to-end » → 5000.
  function enMs(cellule: string): number {
    const m = /([\d,]+)\s*(ms|s)\b/.exec(cellule);
    if (!m) throw new Error(`cellule illisible : ${cellule}`);
    const n = Number(m[1]!.replace(',', '.'));
    return m[2] === 'ms' ? n : n * 1000;
  }

  const lignes = Object.entries(SLA).filter(
    ([, s]) => !s.ligne.includes('(rapprochée)'),
  );

  it.each(lignes)('%s = ligne du CDC, mêmes p95 et p99', (_cat, s) => {
    const rangee = doc
      .split('\n')
      .find((l) => l.replaceAll('**', '').startsWith(`| ${s.ligne} |`));
    expect(rangee, `ligne absente du CDC : ${s.ligne}`).toBeDefined();
    const cellules = rangee!.split('|').map((c) => c.trim());
    expect(s.p95).toBe(enMs(cellules[2]!));
    if ('p99' in s && s.p99 !== undefined)
      expect(s.p99).toBe(enMs(cellules[3]!));
  });

  it('chaque catégorie devient un seuil k6 qui fait échouer le run', () => {
    const t = seuilsK6();
    expect(t['http_req_duration{sla:liste}']).toEqual([
      'p(95)<200',
      'p(99)<500',
    ]);
    expect(t['http_req_failed']).toEqual(['rate<0.001']);
    expect(t['reponses_429']).toEqual(['count<1']);
    for (const c of Object.keys(SLA)) {
      expect(t[`http_req_duration{sla:${c}}`]).toBeDefined();
    }
  });
});

describe('charge — répartition des utilisateurs simulés', () => {
  it("met l'équipe Savr en tête puis tourne sur les 8 traiteurs", () => {
    expect(compteDuVu(1, 6).profil).toBe('equipe');
    expect(compteDuVu(6, 6).profil).toBe('equipe');
    const traiteurs = Array.from({ length: 44 }, (_, i) =>
      compteDuVu(i + 7, 6),
    );
    expect(traiteurs.every((c) => c.profil === 'traiteur')).toBe(true);
    const parOrg = new Map<string, number>();
    for (const c of traiteurs) {
      parOrg.set(c.organisation, (parOrg.get(c.organisation) ?? 0) + 1);
    }
    expect([...parOrg.keys()].sort()).toEqual([...TRAITEURS].sort());
    // 44 sur 8 organisations : 5 ou 6 chacune, jamais tout sur une seule.
    expect(Math.max(...parOrg.values())).toBeLessThanOrEqual(6);
    expect(COMPTES_TRAITEUR).toHaveLength(16);
  });
});

describe('charge — endurance', () => {
  const H = 3_600_000;
  it('découpe 24 h en 2e heure, milieu, dernière heure', () => {
    expect(tranche(0.5 * H, 24 * H)).toBe('milieu');
    expect(tranche(1.5 * H, 24 * H)).toBe('premiere_heure');
    expect(tranche(12 * H, 24 * H)).toBe('milieu');
    expect(tranche(23.5 * H, 24 * H)).toBe('derniere_heure');
  });

  it('échoue au-delà de 20 % de dégradation, réussit en deçà', () => {
    const m = (debut: number, fin: number) => ({
      'http_req_duration{sla:liste,tranche:premiere_heure}': {
        values: { count: 10, 'p(95)': debut },
      },
      'http_req_duration{sla:liste,tranche:derniere_heure}': {
        values: { count: 10, 'p(95)': fin },
      },
    });
    expect(verdictDegradation(m(100, 119), ['liste']).ok).toBe(true);
    expect(verdictDegradation(m(100, 121), ['liste']).ok).toBe(false);
    // Rien de mesuré n'est pas un succès.
    expect(verdictDegradation({}, ['liste']).ok).toBe(false);
  });
});
