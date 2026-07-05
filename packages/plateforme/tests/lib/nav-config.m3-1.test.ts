/**
 * M3.1 — Navigation traiteur (BL-P1-TRAIT-05).
 * CDC §06.04 §1 : nav traiteur = 4 entrées V1 (Dashboard / Collectes /
 * Mon organisation / Mon profil). Le « Registre réglementaire » avait été
 * injecté à tort dans les 2 rôles traiteur → il est retiré ici. Le Registre
 * reste légitime pour gestionnaire_lieux / client_organisateur (contrôle
 * de non-régression ci-dessous).
 */
import { describe, it, expect } from 'vitest';
import { NAV_CONFIG } from '../../src/lib/nav-config.js';

function labels(role: keyof typeof NAV_CONFIG): string[] {
  return NAV_CONFIG[role].flatMap((g) => g.items.map((i) => i.label));
}
function hrefs(role: keyof typeof NAV_CONFIG): string[] {
  return NAV_CONFIG[role].flatMap((g) => g.items.map((i) => i.href));
}

describe('M3.1 / navigation traiteur', () => {
  it('M3.1/nav_traiteur_manager_4_entrees_sans_registre', () => {
    expect(labels('traiteur_manager')).toEqual([
      'Dashboard',
      'Collectes',
      'Mon organisation',
      'Mon profil',
    ]);
    expect(hrefs('traiteur_manager')).not.toContain('/registre');
  });

  it('M3.1/nav_traiteur_commercial_4_entrees_sans_registre', () => {
    expect(labels('traiteur_commercial')).toEqual([
      'Dashboard',
      'Collectes',
      'Mon organisation',
      'Mon profil',
    ]);
    expect(hrefs('traiteur_commercial')).not.toContain('/registre');
  });

  it('M3.1/nav_registre_conserve_gestionnaire — non-régression', () => {
    // Le Registre réglementaire ne doit PAS avoir été retiré des rôles
    // productifs/organisateurs.
    expect(hrefs('gestionnaire_lieux')).toContain('/registre');
  });
});
