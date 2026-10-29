/**
 * M3.3 — Navigation agence (§06.11 « Navigation », réplique du §06.04 §1),
 * plus « Événements » sous « Collectes » depuis le 2026-10-29 (décision Val :
 * liste Événements commune à tous les rôles).
 */
import { describe, it, expect } from 'vitest';
import { NAV_CONFIG } from '../../src/lib/nav-config.js';

describe('M3.3 / navigation agence', () => {
  it('M3.3/navigation_agence_5_entrees_sans_registre', () => {
    const labels = NAV_CONFIG.agence.flatMap((g) =>
      g.items.map((i) => i.label),
    );
    expect(labels).toEqual([
      'Dashboard',
      'Collectes',
      'Événements',
      'Mon organisation',
      'Mon profil',
    ]);
    for (const absente of [
      'Registre réglementaire',
      'Rapports RSE',
      'Mon pack AG',
    ])
      expect(labels).not.toContain(absente);
  });
});
