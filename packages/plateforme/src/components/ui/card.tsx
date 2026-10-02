'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Padding intérieur (R-UI-6b, I3) : les 56 `className="p-4|p-5|p-6"` posés sur
// <Card> dans l'app passent par cette prop. `none` (défaut) = la carte ne pose
// aucun padding, ce sont CardHeader/CardContent/CardFooter qui le portent.
// Le défaut §5.2 (`space-6`) correspond à `lg` ; `md` (p-5) est la recette
// majoritaire du code (×32), `sm` (p-4) la compacte (×10).
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

// Variante (R-UI-6b, I4) : `elevated` = recette « cockpit » relevée ×5 (rayon
// lg + ombre sm au repos, cf. StatCard (ex-KpiCockpitCard) / ChartCard). Rayon lg sur une
// card = arbitrage Q4 ouvert ; la variante centralise sans trancher.
export type CardVariant = 'default' | 'elevated';
const VARIANT: Record<CardVariant, string> = {
  default: 'rounded-savr-md shadow-savr-none',
  elevated: 'rounded-savr-lg shadow-savr-sm',
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  variant?: CardVariant;
}

// Card — levier #5 : bordure neutral-200 portante, ombre nulle au repos
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding = 'none', variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'bg-savr-white border border-savr-neutral-200',
        VARIANT[variant],
        PADDING[padding],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

// Card cliquable : hover → bordure primary-200 + shadow-sm
const CardClickable = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding = 'none', variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'bg-savr-white border border-savr-neutral-200',
        VARIANT[variant],
        PADDING[padding],
        'cursor-pointer transition-[border-color,box-shadow] duration-savr-fast ease-out',
        'hover:border-savr-primary-200 hover:shadow-savr-sm',
        className,
      )}
      {...props}
    />
  ),
);
CardClickable.displayName = 'CardClickable';

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 p-6', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

// Taille du titre (R-UI-6b, I2) : `lg` (défaut) ; `base` remplace les
// surcharges `className="text-base"` relevées ×6.
export type CardTitleSize = 'sm' | 'base' | 'lg';
const TITLE_SIZE: Record<CardTitleSize, string> = {
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
};

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  size?: CardTitleSize;
}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, size = 'lg', ...props }, ref) => (
    <h3
      ref={ref}
      className={cn(
        TITLE_SIZE[size],
        'font-semibold text-savr-neutral-900 tracking-tight',
        className,
      )}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-savr-neutral-500', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center p-6 pt-0 border-t border-savr-neutral-100',
      className,
    )}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardClickable,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};
