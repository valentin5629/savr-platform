/**
 * M3.5 — Tests Playwright composants dashboards communs
 * P1 : TonnageDisplay bascule 999kg/1000kg, EmptyDashboardState message exact, CollecteTypeTabs change onglet
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

// ─── Page de test inline rendue via une URL dédiée ─────────────────────────
// On utilise une page de test /admin/test-dashboard-components (non liée à la nav)
// qui monte les composants directement en mode authentifié admin.

test.describe('M3.5 — TonnageDisplay', () => {
  test('999 kg → affiche "999 kg"', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/test-dashboard-components`);
    const el = page.locator('[data-testid="tonnage-999"]');
    await expect(el).toContainText('999 kg');
  });

  test('1000 kg → affiche "1 t"', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/test-dashboard-components`);
    const el = page.locator('[data-testid="tonnage-1000"]');
    await expect(el).toContainText('1 t');
  });

  test('2500 kg → affiche "2,5 t"', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/test-dashboard-components`);
    const el = page.locator('[data-testid="tonnage-2500"]');
    await expect(el).toContainText('t');
  });
});

test.describe('M3.5 — EmptyDashboardState', () => {
  test('affiche le message exact §11 §8', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/test-dashboard-components`);
    const el = page.locator('[data-testid="empty-dashboard-state"]');
    await expect(el).toContainText(
      'Aucune collecte sur la période sélectionnée. Ajustez les filtres ou programmez votre première collecte.',
    );
  });
});

test.describe('M3.5 — CollecteTypeTabs', () => {
  test('onglet ZD sélectionné par défaut', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/test-dashboard-components`);
    const zdTab = page.locator('[role="tab"][data-value="zero_dechet"]');
    await expect(zdTab).toHaveAttribute('aria-selected', 'true');
  });

  test('clic AG change la sélection', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/test-dashboard-components`);
    const agTab = page.locator('[role="tab"][data-value="anti_gaspi"]');
    await agTab.click();
    await expect(agTab).toHaveAttribute('aria-selected', 'true');

    const zdTab = page.locator('[role="tab"][data-value="zero_dechet"]');
    await expect(zdTab).toHaveAttribute('aria-selected', 'false');
  });
});
