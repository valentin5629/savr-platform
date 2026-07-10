/**
 * R23c / BL-P3-14 — Tolérance Σ mix emballages = 100 % ± 0,05 (CDC §05 l.575 /
 * §04 Data Model). Le constat backlog (« applicatif 0.01 ») est déjà corrigé : les
 * 4 points d'enforcement sont à 0,05. Verrou de non-régression au grain source :
 * route + frontend alignés sur 0,05 (le comportement DB est prouvé par pgTAP
 * M2_4__co2_params_rpc : 99,96 accepté / 105 rejeté). cwd = racine repo (vitest).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

const ROUTE = read(
  'packages/plateforme/src/app/api/v1/admin/parametres/mix-emballages/route.ts',
);
const PAGE = read(
  'packages/plateforme/src/app/(admin)/admin/parametres/co2/page.tsx',
);
const MIGRATION = read(
  'supabase/migrations/20260624150000_plateforme_r3_co2_audit_rpc.sql',
);

describe('M0.8-62 — CO2 mix : tolérance somme 100 % = 0,05 alignée (BL-P3-14)', () => {
  it('route mix-emballages rejette (422) uniquement si |Σ − 100| > 0,05', () => {
    expect(ROUTE).toContain('Math.abs(total - 100) > 0.05');
    // Verrou anti-régression du constat : plus aucun seuil 0.01.
    expect(ROUTE).not.toContain('- 100) > 0.01');
  });

  it('contrôle live du formulaire CO2 aligné sur 0,05', () => {
    expect(PAGE).toContain('Math.abs(mixTotal - 100) < 0.05');
  });

  it('trigger + RPC DB valident la même tolérance 0,05', () => {
    expect(MIGRATION).toContain('ABS(total - 100) > 0.05');
    expect(MIGRATION).toContain('ABS(v_total - 100) > 0.05');
  });
});
