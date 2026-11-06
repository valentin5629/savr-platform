/**
 * M3.3 — Navigation agence (§06.11 « Navigation », réplique du §06.04 §1),
 * plus « Événements » sous « Collectes » depuis le 2026-10-29 (décision Val :
 * liste Événements commune à tous les rôles), et « Mon pack Anti-Gaspi » après
 * « Paramètres » depuis le 2026-11-02 (décision Val : onglet pour tous les rôles
 * clients). Plus d'entrée « Collectes » depuis le 2026-11-05 (décision Val).
 */
import { describe, it, expect } from 'vitest';
import { NAV_CONFIG } from '../../src/lib/nav-config.js';

describe('M3.3 / navigation agence', () => {
  it('M3.3/navigation_agence_4_entrees_sans_registre', () => {
    const labels = NAV_CONFIG.agence.flatMap((g) =>
      g.items.map((i) => i.label),
    );
    expect(labels).toEqual([
      'Dashboard',
      'Événements',
      'Paramètres',
      'Mon pack Anti-Gaspi',
    ]);
    for (const absente of ['Registre réglementaire', 'Rapports RSE'])
      expect(labels).not.toContain(absente);
  });
});
