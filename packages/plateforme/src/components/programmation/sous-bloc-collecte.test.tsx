/**
 * M1.2 — Sous-bloc AG de l'étape 3 du formulaire de programmation : état du pack.
 * Décision Val 2026-10-16 : sans pack actif (ou sans crédit), la collecte AG est
 * facturée à l'unité — une information, jamais une erreur.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SousBlocCollecte } from './sous-bloc-collecte';

const INFO =
  "Pas de pack Anti-Gaspi actif : cette collecte sera facturée à l'unité.";

const donnees = {
  type: 'ag' as const,
  date_collecte: '',
  heure_collecte: '',
  informations_supplementaires: '',
};

function rendre(pack: {
  pack_actif: boolean;
  credits_initiaux?: number;
  credits_restants?: number;
}) {
  render(
    <SousBlocCollecte
      type="ag"
      data={donnees}
      onChange={vi.fn()}
      pack={pack}
    />,
  );
}

describe('M1.2 — sous-bloc AG : état du pack (facturation à l’unité sans pack)', () => {
  it('aucun pack actif : information « facturée à l’unité », jamais une erreur', () => {
    rendre({ pack_actif: false });

    expect(screen.getByRole('status')).toHaveTextContent(INFO);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('pack actif avec crédits : jauge des crédits, aucune information', () => {
    rendre({ pack_actif: true, credits_initiaux: 10, credits_restants: 3 });

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(screen.queryByText(INFO)).toBeNull();
  });

  it('pack actif sans crédit restant : même information que sans pack', () => {
    rendre({ pack_actif: true, credits_initiaux: 10, credits_restants: 0 });

    expect(screen.getByRole('status')).toHaveTextContent(INFO);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
