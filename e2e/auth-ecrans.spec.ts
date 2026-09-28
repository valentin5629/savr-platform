/**
 * AUTH-ECRANS — navigation de l'écran /signup dans un vrai navigateur.
 *
 * Pourquoi un test Playwright et pas jsdom : le défaut couvert ici (le bouton
 * « Retour » recyclé en bouton submit par React entre le clic et son traitement
 * par le navigateur) n'existe qu'avec un vrai moteur de rendu —
 * `fireEvent.submit` ne clique jamais sur un bouton. Page publique, aucun appel
 * serveur : le parcours s'arrête avant toute soumission finale.
 */
import { test, expect } from '@playwright/test';

test('AUTH-ECRANS-1 — /signup : Continuer puis Retour ramène à l’étape 1', async ({
  page,
}) => {
  await page.goto('/signup');
  await expect(page.getByText('Étape 1 sur 3')).toBeVisible();

  await page.getByText('Traiteur', { exact: true }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Étape 2 sur 3')).toBeVisible();

  await page.getByRole('button', { name: 'Retour' }).click();
  await expect(page.getByText('Étape 1 sur 3')).toBeVisible();
  // Le profil choisi est conservé au retour.
  await expect(
    page.locator('input[name="type_profil"][value="traiteur"]'),
  ).toBeChecked();
});
