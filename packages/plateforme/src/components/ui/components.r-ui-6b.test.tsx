/**
 * R-UI-6b — primitives typo & structure : Heading, PageHeader, Text, Card
 * (padding / variant / CardTitle size), StatCard fusionné, ChartTooltip,
 * ToggleChip, LogoCard. Chaque test fige la RECETTE (classes) que la primitive
 * centralise, pour que l'iso-rendu de la migration soit vérifiable ici et non
 * site par site.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';
import { Heading, headingClasses } from '@/components/ui/heading';
import { PageHeader } from '@/components/ui/page-header';
import { Text, textClasses } from '@/components/ui/text';
import { Card, CardClickable, CardTitle } from '@/components/ui/card';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { ChartTooltip } from '@/components/ui/chart-tooltip';
import { ToggleChip } from '@/components/ui/toggle-chip';
import { LogoCard } from '@/components/organisation/logo-card';

describe('Heading — recettes de titres centralisées', () => {
  it('h1 par défaut = recette « text-2xl font-bold text-savr-neutral-900 » ; tone primary = primary-800', () => {
    expect(headingClasses({ level: 1 })).toBe(
      'text-2xl font-bold text-savr-neutral-900',
    );
    expect(headingClasses({ level: 1, tone: 'primary' })).toBe(
      'text-2xl font-bold text-savr-primary-800',
    );
    expect(headingClasses({ level: 2 })).toBe(
      'text-lg font-semibold text-savr-neutral-900',
    );
    expect(headingClasses({ level: 3 })).toBe(
      'text-base font-semibold text-savr-neutral-900',
    );
  });

  it('size / tone « inherit » ne posent aucune classe (titres qui héritent du parent)', () => {
    expect(headingClasses({ level: 2, size: 'inherit', tone: 'inherit' })).toBe(
      'font-semibold',
    );
    expect(headingClasses({ level: 1, tight: true, weight: 'extrabold' })).toBe(
      'text-2xl font-extrabold text-savr-neutral-900 tracking-[-0.02em]',
    );
  });

  it('rend le bon élément hN et fusionne className', () => {
    render(
      <Heading level={2} className="mb-3">
        Section
      </Heading>,
    );
    const h = screen.getByRole('heading', { level: 2, name: 'Section' });
    expect(h.tagName).toBe('H2');
    expect(h.className).toBe(
      'text-lg font-semibold text-savr-neutral-900 mb-3',
    );
  });
});

describe('PageHeader — en-tête sobre', () => {
  it('porte le h1 (tone primary par défaut), la description, l’icône et les actions', () => {
    render(
      <PageHeader
        title="Transporteurs"
        description="Référentiel"
        icon={<span data-testid="icone" />}
        actions={<button type="button">Nouveau</button>}
      />,
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'Transporteurs' });
    expect(h1.className).toBe('text-2xl font-bold text-savr-primary-800');
    expect(screen.getByText('Référentiel').className).toBe(
      'text-sm text-savr-neutral-500',
    );
    expect(screen.getByTestId('icone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouveau' })).toBeInTheDocument();
    expect(h1.closest('header')?.className).toContain('justify-between');
  });

  it('tone neutral + size xl + weight semibold = recette Admin « text-xl font-semibold text-savr-neutral-900 »', () => {
    render(
      <PageHeader
        title="Paramètres"
        tone="neutral"
        size="xl"
        weight="semibold"
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).className).toBe(
      'text-xl font-semibold text-savr-neutral-900',
    );
  });
});

describe('Text — texte courant', () => {
  it('variantes = recettes majoritaires actuelles (A8) ; tailles 11/13 px centralisées telles quelles (A6/Q9)', () => {
    expect(textClasses({})).toBe('text-sm text-savr-neutral-500'); // muted ×73
    expect(textClasses({ variant: 'hint' })).toBe(
      'text-xs text-savr-neutral-500',
    ); // ×53
    expect(textClasses({ variant: 'faint' })).toBe(
      'text-xs text-savr-neutral-400',
    );
    expect(textClasses({ variant: 'body' })).toBe(
      'text-sm text-savr-neutral-700',
    );
    expect(textClasses({ variant: 'overline' })).toBe(
      'text-xs text-savr-neutral-500 font-semibold uppercase tracking-wide',
    );
    expect(textClasses({ size: 'xs-plus' })).toBe(
      'text-[13px] text-savr-neutral-500',
    );
    expect(textClasses({ variant: 'hint', size: '2xs', tone: 'soft' })).toBe(
      'text-[11px] text-savr-neutral-600',
    );
  });

  it('rend <p> par défaut, un autre élément via `as`, et fusionne className', () => {
    const { container } = render(
      <>
        <Text>Para</Text>
        <Text as="span" variant="hint" className="mt-1">
          Span
        </Text>
        <Text as="dt">Terme</Text>
      </>,
    );
    expect(container.querySelector('p')?.textContent).toBe('Para');
    const span = screen.getByText('Span');
    expect(span.tagName).toBe('SPAN');
    expect(span.className).toBe('text-xs text-savr-neutral-500 mt-1');
    expect(screen.getByText('Terme').tagName).toBe('DT');
  });
});

describe('Card — padding, variante elevated, CardTitle size', () => {
  it('padding sm/md/lg = p-4/p-5/p-6, none par défaut', () => {
    const { container } = render(
      <>
        <Card data-testid="c0" />
        <Card data-testid="c1" padding="sm" />
        <Card data-testid="c2" padding="md" />
        <Card data-testid="c3" padding="lg" className="space-y-4" />
      </>,
    );
    const cls = (id: string) => screen.getByTestId(id).className;
    expect(cls('c0')).toBe(
      'bg-savr-white border border-savr-neutral-200 rounded-savr-md shadow-savr-none',
    );
    expect(cls('c1')).toContain('p-4');
    expect(cls('c2')).toContain('p-5');
    expect(cls('c3')).toContain('p-6');
    expect(cls('c3')).toContain('space-y-4');
    expect(container.querySelectorAll('div').length).toBe(4);
  });

  it('variant elevated = recette cockpit (rayon lg + ombre sm au repos), aussi sur CardClickable', () => {
    render(
      <>
        <Card data-testid="e" variant="elevated" padding="lg" />
        <CardClickable data-testid="k" variant="elevated" />
      </>,
    );
    expect(screen.getByTestId('e').className).toBe(
      'bg-savr-white border border-savr-neutral-200 rounded-savr-lg shadow-savr-sm p-6',
    );
    expect(screen.getByTestId('k').className).toContain('rounded-savr-lg');
    expect(screen.getByTestId('k').className).toContain('hover:shadow-savr-sm');
  });

  it('CardTitle size base/sm remplace la surcharge className="text-base"', () => {
    render(
      <>
        <CardTitle>Grand</CardTitle>
        <CardTitle size="base">Moyen</CardTitle>
      </>,
    );
    expect(screen.getByText('Grand').className).toContain('text-lg');
    expect(screen.getByText('Moyen').className).toContain('text-base');
    expect(screen.getByText('Moyen').className).not.toContain('text-lg');
  });
});

describe('StatCard — carte KPI unique (ex-KpiCockpitCard)', () => {
  it('rend libellé, valeur, unité, pastille, badge de variation FR et sparkline', () => {
    const { container } = render(
      <StatCard
        label="Tonnage"
        value="19,6"
        unit="t"
        dotColor="var(--color-savr-dataviz-1)"
        variationPct={-4}
        sparkPoints={[1, 2, 3]}
      />,
    );
    expect(screen.getByText('Tonnage')).toBeInTheDocument();
    expect(screen.getByText('19,6')).toBeInTheDocument();
    expect(screen.getByText('t')).toBeInTheDocument();
    expect(screen.getByText(/▼ 4,0/)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(
      (container.querySelector('span[style]') as HTMLElement).style.background,
    ).toBe('var(--color-savr-dataviz-1)');
  });

  it('sans pastille ni variation : aucun span vide, headerRight affiché ; cliquable = <button>', () => {
    const onClick = vi.fn();
    const { container } = render(
      <StatCard
        label="Poids"
        value="870"
        unit="kg"
        headerRight={<span data-testid="aide" />}
        onClick={onClick}
      />,
    );
    expect(screen.getByTestId('aide')).toBeInTheDocument();
    expect(container.querySelector('span[style]')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('StatCardGrid : 1 / 2 / 3-4 colonnes', () => {
    render(
      <StatCardGrid desktopCols={3} data-testid="g">
        <span />
      </StatCardGrid>,
    );
    const g = screen.getByText('', { selector: 'span' }).parentElement!;
    expect(g.className).toBe(
      'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3',
    );
  });
});

describe('ChartTooltip', () => {
  it('flottante par défaut (hors flux, transparente au pointeur) ; floating=false = en flux', () => {
    render(
      <>
        <ChartTooltip data-testid="t1">a</ChartTooltip>
        <ChartTooltip
          data-testid="t2"
          floating={false}
          className="min-w-[170px]"
        >
          b
        </ChartTooltip>
      </>,
    );
    expect(screen.getByTestId('t1').className).toBe(
      'pointer-events-none absolute z-10 rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 shadow-savr-md',
    );
    expect(screen.getByTestId('t2').className).toBe(
      'rounded-savr-md border border-savr-neutral-200 bg-savr-white px-3 py-2 shadow-savr-md min-w-[170px]',
    );
  });
});

describe('ToggleChip — légende cliquable', () => {
  it('aria-pressed, opacité 0,4 quand masqué, pastille carrée ou trait, 3 variantes', () => {
    const onClick = vi.fn();
    render(
      <>
        <ToggleChip
          pressed
          onClick={onClick}
          swatch={{ color: 'var(--color-savr-dataviz-4)', radius: 3 }}
        >
          Biodéchets
        </ToggleChip>
        <ToggleChip
          pressed={false}
          variant="accent"
          swatch={{ color: 'var(--color-savr-dataviz-2)', shape: 'line' }}
        >
          Taux
        </ToggleChip>
        <ToggleChip pressed variant="bare">
          Repas
        </ToggleChip>
      </>,
    );
    const bio = screen.getByRole('button', { name: 'Biodéchets' });
    expect(bio).toHaveAttribute('aria-pressed', 'true');
    expect(bio.style.opacity).toBe('1');
    expect(bio.className).toContain('border-savr-neutral-100');
    const sw = bio.querySelector('span') as HTMLElement;
    expect(sw.style.width).toBe('10px');
    expect(sw.style.borderRadius).toBe('3px');
    const taux = screen.getByRole('button', { name: 'Taux' });
    expect(taux).toHaveAttribute('aria-pressed', 'false');
    expect(taux.style.opacity).toBe('0.4');
    expect(taux.className).toContain('text-savr-accent-700');
    expect((taux.querySelector('span') as HTMLElement).style.height).toBe(
      '3px',
    );
    expect(screen.getByRole('button', { name: 'Repas' }).className).toContain(
      '-my-3',
    );
    fireEvent.click(bio);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('LogoCard — bloc logo partagé', () => {
  it('sans logo : « Aucun logo » + bouton « Ajouter un logo » ; lecture seule = pas de bouton', () => {
    const { rerender } = render(
      <LogoCard
        logoKey={null}
        uploadUrl="/u"
        previewSrc={(k) => `/p?k=${k}`}
        onUploaded={async () => {}}
      />,
    );
    expect(screen.getByText('Aucun logo.')).toBeInTheDocument();
    expect(screen.getByText('Ajouter un logo')).toBeInTheDocument();
    rerender(
      <LogoCard
        logoKey="org/logo.png"
        uploadUrl="/u"
        previewSrc={(k) => `/p?k=${k}`}
        onUploaded={async () => {}}
        canEdit={false}
      />,
    );
    expect(screen.getByAltText("Logo de l'organisation")).toHaveAttribute(
      'src',
      '/p?k=org/logo.png',
    );
    expect(screen.queryByText(/Ajouter un logo|Remplacer le logo/)).toBeNull();
  });

  it(
    'upload : POST multipart, puis onUploaded(clé) et message de succès ; échec = message d’erreur',
    async () => {
      const onUploaded = vi.fn(async () => {});
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ logo_url: 'org/new.png' }),
      }));
      vi.stubGlobal('fetch', fetchMock);
      const { container } = renderAvecToasts(
        <LogoCard
          logoKey={null}
          uploadUrl="/u"
          previewSrc={(k) => k}
          onUploaded={onUploaded}
        />,
      );
      const input = container.querySelector(
        'input[type=file]',
      ) as HTMLInputElement;
      const file = new File(['x'], 'logo.png', { type: 'image/png' });
      fireEvent.change(input, { target: { files: [file] } });
      expect(
        await screen.findByText('Logo mis à jour.', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        '/u',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(onUploaded).toHaveBeenCalledWith('org/new.png');
      vi.unstubAllGlobals();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'échec de l’envoi : message d’erreur du serveur affiché, onUploaded non appelé, input réinitialisé',
    async () => {
      const onUploaded = vi.fn(async () => {});
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          json: async () => ({ error: 'Fichier trop lourd (2 Mo max).' }),
        })),
      );
      const { container } = render(
        <LogoCard
          logoKey={null}
          uploadUrl="/u"
          previewSrc={(k) => k}
          onUploaded={onUploaded}
        />,
      );
      const input = container.querySelector(
        'input[type=file]',
      ) as HTMLInputElement;
      fireEvent.change(input, {
        target: {
          files: [new File(['x'], 'logo.png', { type: 'image/png' })],
        },
      });
      expect(
        await screen.findByText(
          'Fichier trop lourd (2 Mo max).',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(onUploaded).not.toHaveBeenCalled();
      expect(input.value).toBe('');
      vi.unstubAllGlobals();
    },
    ATTENTE_CAS_MS,
  );
});
