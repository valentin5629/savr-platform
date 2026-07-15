import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Logo Savr officiel — image de marque exacte (« + savr ») embarquée comme
 * masque de luminance et peinte en `currentColor` : rendu pixel-exact de
 * l'asset ET teintable (orange par défaut, vert en contexte ZD). Le PNG source
 * (blanc sur noir, 3334 px) a été recadré et réduit à 551×150 pour le bundle.
 *
 * `variant="mark"` → recadre sur la croix « + » seule (sidebar repliée).
 * `title` fourni → SVG annoncé comme image ; sinon décoratif.
 */
const SAVR_LOGO_MASK =
  'data:image/png;base64,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';

// Boîte de l'image complète et recadrage sur la croix « + » (coords image).
const FULL_VIEWBOX = '0 0 551 150';
const MARK_VIEWBOX = '2 2 146 146';

// Croix « + » (coords image 551×150) : bbox [2..148], carré central [52..98].
// Le « coin haut droit » = bras haut + centre + bras droit (union de 2 rects) —
// le reste de la croix et le mot « savr » restent blancs.
const CORNER_RECTS = [
  { x: 52, y: 0, width: 46, height: 98 }, // bras haut + centre
  { x: 52, y: 52, width: 98, height: 46 }, // centre + bras droit
];

export function SavrLogoMark({
  className,
  title,
  variant = 'full',
  ...props
}: React.SVGProps<SVGSVGElement> & {
  title?: string;
  variant?: 'full' | 'mark';
}) {
  const rawId = React.useId().replace(/:/g, '');
  const maskId = `savr-logo-${rawId}`;
  const clipId = `savr-corner-${rawId}`;
  return (
    <svg
      viewBox={variant === 'mark' ? MARK_VIEWBOX : FULL_VIEWBOX}
      className={cn(variant === 'mark' ? 'h-7 w-7' : 'h-8 w-auto', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      <defs>
        <mask id={maskId}>
          <image
            href={SAVR_LOGO_MASK}
            width="551"
            height="150"
            preserveAspectRatio="none"
          />
        </mask>
        <clipPath id={clipId}>
          {CORNER_RECTS.map((r, i) => (
            <rect key={i} {...r} />
          ))}
        </clipPath>
      </defs>
      {/* Logo entier en blanc */}
      <rect width="551" height="150" fill="#ffffff" mask={`url(#${maskId})`} />
      {/* Coin haut droit de la croix teinté (orange AG / vert ZD via currentColor) */}
      <g clipPath={`url(#${clipId})`}>
        <rect
          width="551"
          height="150"
          fill="currentColor"
          mask={`url(#${maskId})`}
        />
      </g>
    </svg>
  );
}
