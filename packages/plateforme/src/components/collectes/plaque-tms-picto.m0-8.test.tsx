/**
 * R23c / BL-P3-12 — Picto plaque TMS (fiche collecte Admin, CDC §11 l.210).
 * Vert si TOUTES les tournées ont leur plaque communiquée, gris si au moins une
 * manque. Teste la règle (helper) + le rendu (couleur + aria-label).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { plaqueTmsComplete } from '@/lib/statut-tms-labels';
import { PlaqueTmsPicto } from './plaque-tms-picto';

const t = (plaque: string | null, type_vehicule: string | null = null) => ({
  tournees: { plaque_immatriculation: plaque, type_vehicule },
});

describe('M0.8-60 — Picto plaque TMS : vert ssi toutes les tournées ont leur plaque (BL-P3-12)', () => {
  it('règle : vert seulement si TOUTES les tournées ont une plaque', () => {
    expect(plaqueTmsComplete([])).toBe(false); // aucune tournée
    expect(plaqueTmsComplete([t('AB-123-CD')])).toBe(true);
    expect(plaqueTmsComplete([t('AB-123-CD'), t('EF-456-GH')])).toBe(true);
    expect(plaqueTmsComplete([t('AB-123-CD'), t(null)])).toBe(false); // une manque
    expect(plaqueTmsComplete([t(null)])).toBe(false);
    // Vélo cargo (A Toutes!) : pas de plaque attendue → complet.
    expect(plaqueTmsComplete([t(null, 'velo_cargo')])).toBe(true);
    expect(plaqueTmsComplete([t('AB-123-CD'), t(null, 'velo_cargo')])).toBe(
      true,
    );
  });

  it('rendu vert quand toutes les plaques sont communiquées', () => {
    render(<PlaqueTmsPicto tournees={[t('AB-123-CD'), t('EF-456-GH')]} />);
    const picto = screen.getByTestId('picto-plaque-tms');
    expect(picto).toHaveAttribute('aria-label', 'Plaque TMS communiquée');
    expect(picto.className).toContain('savr-success-strong');
  });

  it('rendu gris quand au moins une plaque manque (multi-camions)', () => {
    render(<PlaqueTmsPicto tournees={[t('AB-123-CD'), t(null)]} />);
    const picto = screen.getByTestId('picto-plaque-tms');
    expect(picto).toHaveAttribute('aria-label', 'Plaque TMS manquante');
    expect(picto.className).toContain('savr-neutral-400');
  });
});
