'use client';

import * as React from 'react';
import { DayPicker, getDefaultClassNames } from 'react-day-picker';
import { fr } from 'react-day-picker/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Calendar — react-day-picker v9, locale FR, semaine du lundi (shadcn stylé
// Savr). Bornes de période en primary-700, jours intermédiaires en primary-50,
// jour courant en accent-700 (DS Claude Design « Calendar »).
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const d = getDefaultClassNames();
  return (
    <DayPicker
      locale={fr}
      weekStartsOn={1}
      showOutsideDays={showOutsideDays}
      className={cn('p-1 text-savr-neutral-900', className)}
      classNames={{
        root: cn(d.root, 'w-fit'),
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-3',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
        button_previous:
          'inline-flex h-8 w-8 items-center justify-center rounded-savr-md text-savr-neutral-600 hover:bg-savr-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 disabled:opacity-40',
        button_next:
          'inline-flex h-8 w-8 items-center justify-center rounded-savr-md text-savr-neutral-600 hover:bg-savr-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 disabled:opacity-40',
        month_caption: 'flex h-8 items-center justify-center',
        caption_label: 'text-sm font-semibold capitalize',
        dropdowns: 'flex items-center gap-2 text-sm font-semibold',
        dropdown_root:
          'relative rounded-savr-md border border-savr-neutral-300',
        dropdown: 'absolute inset-0 cursor-pointer opacity-0',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'w-9 text-center text-xs font-semibold capitalize text-savr-neutral-500',
        week: 'mt-1 flex w-full',
        day: 'relative h-9 w-9 p-0 text-center text-sm',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-savr-md font-medium transition-colors duration-[120ms] hover:bg-savr-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
        today: '[&>button]:font-bold [&>button]:text-savr-accent-700',
        selected:
          '[&>button]:bg-savr-primary-700 [&>button]:text-savr-white [&>button]:hover:bg-savr-primary-800',
        range_start: 'rounded-l-savr-md bg-savr-primary-50',
        range_end: 'rounded-r-savr-md bg-savr-primary-50',
        range_middle:
          'bg-savr-primary-50 [&>button]:!bg-transparent [&>button]:!text-savr-primary-900 [&>button]:hover:!bg-savr-primary-100',
        outside: 'text-savr-neutral-400',
        disabled: 'opacity-40 [&>button]:cursor-not-allowed',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
