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
  it('forme="badge" (Transporteurs) : ZD primary / AG action, sans icône', () => {
    const { rerender } = render(
      <TypeCollecteBadge type="zero_dechet" forme="badge" />,
    );
    let badge = screen.getByText('ZD').closest('span')!;
    expect(badge.querySelector('svg')).toBeNull();
    const zd = badge.className;
    rerender(<TypeCollecteBadge type="anti_gaspi" forme="badge" />);
    badge = screen.getByText('AG').closest('span')!;
    expect(badge.className).not.toBe(zd);
  });

  it('forme="pastille" par défaut : ZD vert / AG ambre, icône, sans point', () => {
    const { rerender } = render(<TypeCollecteBadge type="zero_dechet" />);
    // Pas d'identifiant de test sur la pastille (réservé à l'en-tête de fiche).
    expect(screen.queryByTestId('badge-type-collecte')).toBeNull();
    let badge = screen.getByText('ZD').closest('span')!;
    expect(badge.textContent).toBe('ZD');
    expect(badge.className).toContain('bg-savr-success-subtle');
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(badge.querySelector('.rounded-full')).toBeNull();

    rerender(<TypeCollecteBadge type="anti_gaspi" />);
    badge = screen.getByText('AG').closest('span')!;
    expect(badge.textContent).toBe('AG');
    expect(badge.className).toContain('bg-savr-warning-subtle');
  });

  it('forme="plein" (fiches collecte) : aplat ZD navy / AG orange, libellé long', () => {
    const { rerender } = render(
      <TypeCollecteBadge type="zero_dechet" forme="plein" />,
    );
    let badge = screen.getByTestId('badge-type-collecte');
    expect(badge.textContent).toBe('Zéro Déchet');
    expect(badge.className).toContain('bg-savr-primary-700');
    expect(badge.className).toContain('text-savr-white');
    expect(badge.className).toContain('uppercase');
    expect(badge.querySelector('svg')).toBeNull();

    rerender(<TypeCollecteBadge type="anti_gaspi" forme="plein" />);
    badge = screen.getByTestId('badge-type-collecte');
    expect(badge.textContent).toBe('Anti-Gaspi');
    expect(badge.className).toContain('bg-savr-accent-500');
    expect(badge.className).toContain('text-savr-primary-950');
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
  it('size="sm" passe le texte à 11 px (text-xs retiré par twMerge)', () => {
    render(<Badge size="sm">Dense</Badge>);
    const badge = screen.getByText('Dense');
    expect(badge.className).toContain('text-[11px]');
    expect(badge.className).not.toContain('text-xs');
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
