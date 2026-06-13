'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// Card — levier #5 : bordure neutral-200 portante, ombre nulle au repos
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'bg-savr-white border border-savr-neutral-200 rounded-savr-md shadow-savr-none',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

// Card cliquable : hover → bordure primary-200 + shadow-sm
const CardClickable = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'bg-savr-white border border-savr-neutral-200 rounded-savr-md shadow-savr-none',
      'cursor-pointer transition-[border-color,box-shadow] duration-[120ms] ease-out',
      'hover:border-savr-primary-200 hover:shadow-savr-sm',
      className,
    )}
    {...props}
  />
));
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

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'text-lg font-semibold text-savr-neutral-900 tracking-tight',
      className,
    )}
    {...props}
  />
));
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
