import { type Page, expect, test } from '@playwright/test';

const readout = (page: Page, label: string) =>
  page.locator('.readout', { has: page.locator('dt', { hasText: label }) }).locator('dd span');

async function startFreeTraining(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.getByRole('button', { name: /Free training/ }).click();
  await expect(page.locator('#hud')).toBeVisible();
  return errors;
}

test('the menu lists the six missions', async ({ page }) => {
  await page.goto('./');

  await expect(page.locator('.mission-row')).toHaveCount(6);
  await expect(page.getByRole('button', { name: /Precision/ })).toBeVisible();
});

test('holding D slews the jib and the instruments follow', async ({ page }) => {
  const errors = await startFreeTraining(page);
  const before = await readout(page, 'Slew').innerText();

  await page.keyboard.down('KeyD');
  await expect(readout(page, 'Slew')).not.toHaveText(before, { timeout: 15_000 });
  await page.keyboard.up('KeyD');

  expect(errors).toEqual([]);
});

test('W sends the trolley out and lowers the rated capacity', async ({ page }) => {
  await startFreeTraining(page);

  await page.keyboard.down('KeyW');
  await expect(readout(page, 'Capacity')).not.toHaveText('8.00', { timeout: 20_000 });
  await page.keyboard.up('KeyW');

  expect(Number(await readout(page, 'Radius').innerText())).toBeGreaterThan(15);
});

test('C cycles the cameras and Escape pauses into the menu', async ({ page }) => {
  await startFreeTraining(page);
  const camera = page.locator('.camera__mode');

  await expect(camera).toHaveText('Cab');
  await page.keyboard.press('KeyC');
  await expect(camera).toHaveText('External');
  await page.keyboard.press('KeyC');
  await expect(camera).toHaveText('Hook');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('the emergency stop latches and shows on the panel', async ({ page }) => {
  await startFreeTraining(page);

  await page.keyboard.press('KeyX');

  await expect(page.getByRole('alert')).toContainText('Emergency stop');
});

test('the instrument panel fits a phone screen without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await startFreeTraining(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  expect(overflow).toBeLessThanOrEqual(0);
});

test('the interface starts in English and the flags switch it to Portuguese', async ({ page }) => {
  await page.goto('./');
  const english = page.getByRole('button', { name: 'English' });
  const portuguese = page.getByRole('button', { name: 'Português' });

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(english).toHaveAttribute('aria-pressed', 'true');

  await portuguese.click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(portuguese).toHaveAttribute('aria-pressed', 'true');
  await expect(portuguese).toBeFocused();
  await expect(page.getByRole('button', { name: /Treino livre/ })).toBeVisible();
  await expect(page).toHaveTitle(/Simulador/);
});

test('the chosen language survives a reload and reaches the instrument panel', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Português' }).click();
  await page.reload();

  await page.getByRole('button', { name: /Treino livre/ }).click();

  await expect(page.locator('.camera__mode')).toHaveText('Cabine');
  await expect(readout(page, 'Giro')).toBeVisible();
});
