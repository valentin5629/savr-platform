'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ icon, title, description, action, className }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center gap-4 py-16 px-8 text-center',
        className,
      )}
    >
      {icon && (
        <div className="text-savr-primary-300 [&>svg]:h-12 [&>svg]:w-12 [&>svg]:stroke-[1.5]">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-base font-semibold text-savr-neutral-900">{title}</p>
        {description && (
          <p className="text-sm text-savr-neutral-500">{description}</p>
        )}
      </div>
      {action && (
        <Button variant="secondary" size="md" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  ),
);
EmptyState.displayName = 'EmptyState';

export { EmptyState };
