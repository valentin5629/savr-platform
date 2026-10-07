/**
 * R-UI-2 (C2, C3, C6, C14, C15) — badges partagés : type de collecte, statut de
 * facture, actif / inactif, taille `sm` et variante `count` de `Badge`.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';
import { ActifBadge } from './actif-badge';
import { FactureStatutBadge } from './facture-statut-badge';
import { TypeCollecteBadge } from './type-collecte-badge';

describe('R-UI-2 — TypeCollecteBadge (C2)', () => {
  // Arbitrage Q1 (Val, 2026-10-07) : ZD vert, AG navy pour toutes les formes.
  it('forme="badge" (Transporteurs) : ZD vert / AG navy, sans icône', () => {
    const { rerender } = render(
      <TypeCollecteBadge type="zero_dechet" forme="badge" />,
    );
    let badge = screen.getByText('ZD').closest('span')!;
    expect(badge.querySelector('svg')).toBeNull();
    expect(badge.className).toContain('bg-savr-success-subtle');
    rerender(<TypeCollecteBadge type="anti_gaspi" forme="badge" />);
    badge = screen.getByText('AG').closest('span')!;
    expect(badge.className).toContain('bg-savr-primary-50');
    expect(badge.className).toContain('text-savr-primary-700');
  });

  it('forme="pastille" par défaut : ZD vert / AG navy, icône, sans point', () => {
    const { rerender } = render(<TypeCollecteBadge type="zero_dechet" />);
    // Pas d'identifiant de test sur la pastille (réservé à l'en-tête de fiche).
    expect(screen.queryByTestId('badge-type-collecte')).toBeNull();
    let badge = screen.getByText('ZD').closest('span')!;
    expect(badge.textContent).toBe('ZD');
    expect(badge.className).toContain('bg-savr-success-subtle');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.querySelector('.rounded-savr-full')).toBeNull();

    rerender(<TypeCollecteBadge type="anti_gaspi" />);
    badge = screen.getByText('AG').closest('span')!;
    expect(badge.textContent).toBe('AG');
    expect(badge.className).toContain('bg-savr-primary-50');
    expect(badge.className).not.toContain('accent');
    expect(badge.className).not.toContain('warning');
  });

  it('forme="plein" (fiches collecte) : aplat ZD vert / AG navy, texte blanc, libellé long', () => {
    const { rerender } = render(
      <TypeCollecteBadge type="zero_dechet" forme="plein" />,
    );
    let badge = screen.getByTestId('badge-type-collecte');
    expect(badge.textContent).toBe('Zéro Déchet');
    expect(badge.className).toContain('bg-savr-success-strong');
    expect(badge.className).toContain('text-savr-white');
    expect(badge.className).toContain('uppercase');
    expect(badge.querySelector('svg')).toBeNull();

    rerender(<TypeCollecteBadge type="anti_gaspi" forme="plein" />);
    badge = screen.getByTestId('badge-type-collecte');
    expect(badge.textContent).toBe('Anti-Gaspi');
    expect(badge.className).toContain('bg-savr-primary-700');
    expect(badge.className).toContain('text-savr-white');
    expect(badge.className).not.toContain('accent');
  });

  it('type inconnu : valeur brute, couleur neutre', () => {
    render(<TypeCollecteBadge type="autre" />);
    const badge = screen.getByText('autre').closest('span')!;
    expect(badge.textContent).toBe('autre');
    expect(badge.className).toContain('bg-savr-neutral-100');
  });
});

describe('R-UI-2 — FactureStatutBadge (C3)', () => {
  it.each([
    ['brouillon', 'Brouillon', 'bg-savr-neutral-100'],
    ['en_attente_pennylane', 'En attente Pennylane', 'bg-savr-warning-subtle'],
    ['emise', 'Émise', 'bg-savr-info-subtle'],
    ['payee', 'Payée', 'bg-savr-success-subtle'],
    ['annulee', 'Annulée', 'bg-savr-error-subtle'],
  ])('%s → « %s » (%s)', (statut, libelle, classe) => {
    render(<FactureStatutBadge statut={statut} />);
    expect(screen.getByText(libelle).className).toContain(classe);
  });

  it('statut inconnu : valeur brute, neutre', () => {
    render(<FactureStatutBadge statut="bizarre" />);
    expect(screen.getByText('bizarre').className).toContain(
      'bg-savr-neutral-100',
    );
  });
});

describe('R-UI-2 — ActifBadge (C6)', () => {
  it('Actif vert / Inactif neutre ; association au féminin', () => {
    const { rerender } = render(<ActifBadge actif />);
    expect(screen.getByText('Actif').className).toContain(
      'bg-savr-success-subtle',
    );
    rerender(<ActifBadge actif={false} />);
    expect(screen.getByText('Inactif').className).toContain(
      'bg-savr-neutral-100',
    );
    rerender(<ActifBadge actif={false} sujet="association" />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });
});

describe('R-UI-2 — Badge : size="sm" (C14) et variant="count" (C15)', () => {
  it('size="sm" : texte à 12 px (Q9 b — 11 px arrondi à text-xs), padding conservé', () => {
    render(<Badge size="sm">Dense</Badge>);
    const badge = screen.getByText('Dense');
    expect(badge.className).toContain('text-xs');
    expect(badge.className).not.toContain('text-[11px]');
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('py-0.5');
  });

  it('size="sm" rend exactement comme la taille par défaut (alias Q9 b)', () => {
    render(
      <>
        <Badge size="sm">A</Badge>
        <Badge>B</Badge>
      </>,
    );
    const classes = (t: string) =>
      screen.getByText(t).className.split(/\s+/).sort().join(' ');
    expect(classes('A')).toBe(classes('B'));
  });

  it('taille par défaut inchangée (text-xs)', () => {
    render(<Badge>Normal</Badge>);
    expect(screen.getByText('Normal').className).toContain('text-xs');
  });

  it('variant="count" : pastille rouge pleine, centrée, sans point', () => {
    render(<Badge variant="count">3</Badge>);
    const badge = screen.getByText('3');
    expect(badge.className).toContain('bg-savr-error');
    expect(badge.className).toContain('text-savr-white');
    expect(badge.className).toContain('min-w-[1.25rem]');
    expect(badge.className).toContain('justify-center');
    expect(badge.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('variant="count" accepte un point si demandé explicitement', () => {
    render(
      <Badge variant="count" dot>
        5
      </Badge>,
    );
    expect(
      screen.getByText('5').querySelector('[aria-hidden="true"]'),
    ).not.toBeNull();
  });
});
