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
      className={`inline-flex h-11 items-center gap-1 rounded-savr-md border border-savr-neutral-200 bg-savr-white p-1 sm:h-10 ${className ?? ''}`}
    >
      <button
        role="tab"
        aria-selected={value === 'zero_dechet'}
        data-value="zero_dechet"
        onClick={() => onChange('zero_dechet')}
        className={`inline-flex h-full items-center rounded-savr-sm px-3 text-sm font-semibold transition-colors duration-[120ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 ${
          value === 'zero_dechet'
            ? 'bg-savr-primary-700 text-savr-white'
            : 'text-savr-neutral-600 hover:bg-savr-neutral-100 hover:text-savr-neutral-900'
        }`}
      >
        Zéro déchet
      </button>
      <button
        role="tab"
        aria-selected={value === 'anti_gaspi'}
        data-value="anti_gaspi"
        onClick={() => onChange('anti_gaspi')}
        className={`inline-flex h-full items-center rounded-savr-sm px-3 text-sm font-semibold transition-colors duration-[120ms] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 ${
          value === 'anti_gaspi'
            ? 'bg-savr-primary-700 text-savr-white'
            : 'text-savr-neutral-600 hover:bg-savr-neutral-100 hover:text-savr-neutral-900'
        }`}
      >
        Anti-gaspi
      </button>
    </div>
  );
}
