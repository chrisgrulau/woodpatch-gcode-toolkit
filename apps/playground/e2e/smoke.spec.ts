// SPDX-FileCopyrightText: 2026 Promotional Notions Pty Ltd trading as Woodpatch House & Garden
// SPDX-License-Identifier: MIT
import { expect, test, type Page } from '@playwright/test';

/** Page errors and CSP violations fail every test. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  return problems;
}

const status = (page: Page) => page.locator('#status');

test('loads the default sample, draws it, and reports its stats', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(status(page)).toContainText('Read in', { timeout: 30_000 });
  await expect(page.locator('#stats')).toContainText('segments');
  await expect(page.locator('.cm-content')).toContainText('G');

  // The 3D view has drawn something: it differs clearly from an empty view.
  const view = page.locator('#view');
  const drawn = (await view.screenshot()).length;
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('#stats')).toContainText('no motion', { timeout: 10_000 });
  const empty = (await view.screenshot()).length;
  expect(drawn).toBeGreaterThan(empty * 1.3);
  expect(problems).toEqual([]);
});

test('the Masso sample shows diagnostics, and one moves the editor to its line', async ({
  page,
}) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(status(page)).toContainText('Read in', { timeout: 30_000 });
  await page.selectOption('#dialect', 'masso-g3-5.13');
  await page.selectOption('#sample', 'masso-dialect-test-v1.nc');
  // Wait for the Masso reading of the Masso program: its T1 (a feed move before any F)
  // is only a warning under Masso. Earlier reads' lists may still be on screen before.
  await expect(page.locator('.cm-content')).toContainText('WOODPATCH MASSO DIALECT TEST', {
    timeout: 30_000,
  });
  await expect(page.locator('#diagnostics')).toContainText('SEMANTIC_FEED_UNSPECIFIED', {
    timeout: 30_000,
  });
  const first = page.locator('#diagnostics li button:not([disabled])').first();
  const label = (await first.textContent()) ?? '';
  const line = Number(label.replace(/\D+/g, ''));
  expect(line).toBeGreaterThan(0);
  await first.click();
  // The editor's active line is the diagnostic's line.
  const active = page.locator('.cm-lineNumbers .cm-activeLineGutter');
  await expect(active).toHaveText(String(line));
  expect(problems).toEqual([]);
});

test('editing the code re-reads it', async ({ page }) => {
  const problems = watch(page);
  await page.goto('/');
  await expect(status(page)).toContainText('Read in', { timeout: 30_000 });
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('G21 G90\nG0 X10 Y10\nG1 Z-1 F100\nG2 X20 Y10 R5');
  await expect(page.locator('#stats')).toContainText('4 lines', { timeout: 10_000 });
  await expect(page.locator('#stats')).toContainText('extent 20.0 × 15.0 × 1.0 mm');
  expect(problems).toEqual([]);
});
