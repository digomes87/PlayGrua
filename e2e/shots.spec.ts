import { expect, test } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR;

test.skip(SHOTS === undefined, 'screenshot capture only runs when SHOTS_DIR is set');

test('capture menu and the three cameras', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('./');
  await expect(page.getByRole('button', { name: /Free training/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/menu.png` });
  await page.getByRole('button', { name: /Free training/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/cab.png` });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/orbit.png` });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/hook.png` });
  expect(errors).toEqual([]);
});
