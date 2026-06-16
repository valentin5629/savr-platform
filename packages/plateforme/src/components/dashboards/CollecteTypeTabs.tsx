'use client';

export type CollecteType = 'zero_dechet' | 'anti_gaspi';

interface CollecteTypeTabsProps {
  value: CollecteType;
  onChange: (type: CollecteType) => void;
  className?: string;
}

/**
 * Onglets ZD / AG — obligatoires sur tous les dashboards qui agrègent de la collecte (§11 règle structurante V1).
 */
export function CollecteTypeTabs({
  value,
  onChange,
  className,
}: CollecteTypeTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Type de collecte"
      className={`inline-flex rounded-md border border-border bg-muted p-1 ${className ?? ''}`}
    >
      <button
        role="tab"
        aria-selected={value === 'zero_dechet'}
        data-value="zero_dechet"
        onClick={() => onChange('zero_dechet')}
        className={`rounded px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          value === 'zero_dechet'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Zéro déchet
      </button>
      <button
        role="tab"
        aria-selected={value === 'anti_gaspi'}
        data-value="anti_gaspi"
        onClick={() => onChange('anti_gaspi')}
        className={`rounded px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          value === 'anti_gaspi'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        Anti-gaspi
      </button>
    </div>
  );
}
