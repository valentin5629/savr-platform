// Courbes lissées des graphiques des dashboards. Interpolation monotone
// (Fritsch-Carlson) : entre deux points, la courbe ne sort jamais de leurs
// valeurs, donc un taux à 100 % n'est jamais dessiné au-dessus de 100 %.

export interface Point {
  x: number;
  y: number;
}

// Coordonnée SVG arrondie au dixième (jamais affichée à l'écran).
const f = (v: number) => String(Math.round(v * 10) / 10);

/** Chemin SVG lissé passant par chaque point (x croissants). */
export function courbeLissee(pts: Point[]): string {
  const n = pts.length;
  if (n === 0) return '';
  const p0 = pts[0]!;
  if (n === 1) return `M${f(p0.x)},${f(p0.y)}`;

  const dx: number[] = [];
  const pente: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    dx[i] = b.x - a.x;
    pente[i] = dx[i]! === 0 ? 0 : (b.y - a.y) / dx[i]!;
  }

  const tangente: number[] = new Array(n);
  tangente[0] = pente[0]!;
  tangente[n - 1] = pente[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const s0 = pente[i - 1]!;
    const s1 = pente[i]!;
    const h0 = dx[i - 1]!;
    const h1 = dx[i]!;
    // Pic, creux ou palier : tangente horizontale, pas de dépassement.
    tangente[i] =
      s0 * s1 <= 0
        ? 0
        : (3 * (h0 + h1)) / ((2 * h1 + h0) / s0 + (h1 + 2 * h0) / s1);
  }

  let d = `M${f(p0.x)},${f(p0.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const h = dx[i]! / 3;
    d += ` C${f(a.x + h)},${f(a.y + tangente[i]! * h)} ${f(b.x - h)},${f(b.y - tangente[i + 1]! * h)} ${f(b.x)},${f(b.y)}`;
  }
  return d;
}
