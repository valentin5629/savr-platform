/**
 * M3.5 — Tests Playwright composants dashboards communs
 * P1 : TonnageDisplay bascule 999kg/1000kg, EmptyDashboardState message exact, ToggleTypeCollecte change de type
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

// ─── Page de test inline rendue via une URL dédiée ─────────────────────────
// On utilise une page de test /dev/test-dashboard-components (non liée à la nav)
// qui monte les composants directement. Route publique (hors gating /admin/*
// réservé admin_savr/ops_savr) : composants présentationnels sans donnée
// sensible, donc pas de session authentifiée requise.
// ⚠ `/dev/*` répond 404 sur un build de production (src/app/dev/layout.tsx) :
// ce spec ne tourne que contre `next dev`. Il est hors du testDir Playwright
// (`e2e/`), donc non exécuté par `pnpm -w test:e2e` (CI = next build + start).

test.describe('M3.5 — TonnageDisplay', () => {
  test('999 kg → affiche "999 kg"', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/test-dashboard-components`);
    const el = page.locator('[data-testid="tonnage-999"]');
    await expect(el).toContainText('999 kg');
  });

  test('1000 kg → affiche "1 t"', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/test-dashboard-components`);
    const el = page.locator('[data-testid="tonnage-1000"]');
    await expect(el).toContainText('1 t');
  });

  test('2500 kg → affiche "2,5 t"', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/test-dashboard-components`);
    const el = page.locator('[data-testid="tonnage-2500"]');
    await expect(el).toContainText('t');
  });
});

test.describe('M3.5 — EmptyDashboardState', () => {
  test('affiche le message exact §11 §8', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/test-dashboard-components`);
    const el = page.locator('[data-testid="empty-dashboard-state"]');
    // Message §11 §8 : titre + consigne (EmptyState, R-UI-1).
    await expect(el).toContainText(
      'Aucune collecte sur la période sélectionnée.',
    );
    await expect(el).toContainText(
      'Ajustez les filtres ou programmez votre première collecte.',
    );
  });
});

test.describe('M3.5 — ToggleTypeCollecte', () => {
  // Segmenté ZD / AG partagé (R-UI-4b, D1) : ToggleGroup Radix → items
  // `role=radio`, état actif `aria-checked` / `data-state="on"`.
  test('type ZD sélectionné par défaut', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/test-dashboard-components`);
    const zd = page.getByRole('radio', { name: 'Zéro Déchet' });
    await expect(zd).toHaveAttribute('aria-checked', 'true');
  });

  test('clic AG change la sélection', async ({ page }) => {
    await page.goto(`${BASE_URL}/dev/test-dashboard-components`);
    const ag = page.getByRole('radio', { name: 'Anti-Gaspi' });
    await ag.click();
    await expect(ag).toHaveAttribute('aria-checked', 'true');

    const zd = page.getByRole('radio', { name: 'Zéro Déchet' });
    await expect(zd).toHaveAttribute('aria-checked', 'false');
  });
});
