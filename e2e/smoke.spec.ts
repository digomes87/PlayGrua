import { type Page, expect, test } from '@playwright/test';

const readout = (page: Page, label: string) =>
  page.locator('.readout', { has: page.locator('dt', { hasText: label }) }).locator('dd span');

async function startFreeTraining(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.getByRole('button', { name: /Treino livre/ }).click();
  await expect(page.locator('#hud')).toBeVisible();
  return errors;
}

test('the menu lists the six missions', async ({ page }) => {
  await page.goto('./');

  await expect(page.locator('.mission-row')).toHaveCount(6);
  await expect(page.getByRole('button', { name: /Precisão/ })).toBeVisible();
});

test('holding D slews the jib and the instruments follow', async ({ page }) => {
  const errors = await startFreeTraining(page);
  const before = await readout(page, 'Giro').innerText();

  await page.keyboard.down('KeyD');
  await expect(readout(page, 'Giro')).not.toHaveText(before, { timeout: 15_000 });
  await page.keyboard.up('KeyD');

  expect(errors).toEqual([]);
});

test('W sends the trolley out and lowers the rated capacity', async ({ page }) => {
  await startFreeTraining(page);

  await page.keyboard.down('KeyW');
  await expect(readout(page, 'Capacidade')).not.toHaveText('8.00', { timeout: 20_000 });
  await page.keyboard.up('KeyW');

  expect(Number(await readout(page, 'Raio').innerText())).toBeGreaterThan(15);
});

test('C cycles the cameras and Escape pauses into the menu', async ({ page }) => {
  await startFreeTraining(page);
  const camera = page.locator('.camera__mode');

  await expect(camera).toHaveText('Cabine');
  await page.keyboard.press('KeyC');
  await expect(camera).toHaveText('Externa');
  await page.keyboard.press('KeyC');
  await expect(camera).toHaveText('Gancho');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible();
});

test('the emergency stop latches and shows on the panel', async ({ page }) => {
  await startFreeTraining(page);

  await page.keyboard.press('KeyX');

  await expect(page.getByRole('alert')).toContainText('Parada de emergência');
});

test('the instrument panel fits a phone screen without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await startFreeTraining(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  expect(overflow).toBeLessThanOrEqual(0);
});
