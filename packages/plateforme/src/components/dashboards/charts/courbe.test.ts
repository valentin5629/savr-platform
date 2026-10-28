import { describe, expect, it } from 'vitest';
import { courbeLissee, type Point } from './courbe';

// Lit les segments « C x1,y1 x2,y2 x,y » d'un chemin.
function segments(d: string): number[][] {
  return [...d.matchAll(/C([^C]+)/g)].map((m) =>
    m[1]!.trim().split(/[ ,]+/).map(Number),
  );
}

describe('courbeLissee', () => {
  it('passe par chaque point', () => {
    const pts: Point[] = [
      { x: 0, y: 50 },
      { x: 10, y: 20 },
      { x: 20, y: 80 },
    ];
    const d = courbeLissee(pts);
    expect(d.startsWith('M0.0,50.0')).toBe(true);
    const segs = segments(d);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.slice(4)).toEqual([10, 20]);
    expect(segs[1]!.slice(4)).toEqual([20, 80]);
  });

  it('ne dépasse jamais les valeurs de ses deux points (pas de taux > 100 %)', () => {
    // y = 20 correspond à 100 % : la courbe ne doit jamais monter au-dessus.
    const pts: Point[] = [
      { x: 0, y: 120 },
      { x: 10, y: 20 },
      { x: 20, y: 20 },
      { x: 30, y: 90 },
      { x: 40, y: 21 },
    ];
    const segs = segments(courbeLissee(pts));
    segs.forEach((s, i) => {
      const yA = pts[i]!.y;
      const yB = pts[i + 1]!.y;
      const bas = Math.min(yA, yB);
      const haut = Math.max(yA, yB);
      // Points de contrôle dans l'intervalle → la courbe aussi (enveloppe convexe).
      expect(s[1]!).toBeGreaterThanOrEqual(bas - 0.05);
      expect(s[1]!).toBeLessThanOrEqual(haut + 0.05);
      expect(s[3]!).toBeGreaterThanOrEqual(bas - 0.05);
      expect(s[3]!).toBeLessThanOrEqual(haut + 0.05);
    });
  });

  it('cas limites : aucun point, un seul point', () => {
    expect(courbeLissee([])).toBe('');
    expect(courbeLissee([{ x: 5, y: 7 }])).toBe('M5.0,7.0');
  });
});
