import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, access } from 'node:fs/promises';

test('the journal opens, navigates, and preserves its theme across pages', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('LOOK');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Writing', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('The notebook');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'About', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('asking why');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
});

test('category filters, full text search, reset, and shortcuts work', async ({ page }) => {
  await page.goto('/writing/');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'Research 0' }).click();
  await expect(page.getByRole('heading', { name: 'No threads here. Yet.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Research 0' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await page.getByRole('searchbox').fill('half-finished');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
  await page.getByRole('searchbox').fill('nothing-matches-this');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
  await page.goto('/writing/?q=introduction');
  await expect(page.getByRole('searchbox')).toHaveValue('introduction');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
});

test('reading controls and article links work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/writing/a-place-for-the-details/');
  await page.getByRole('button', { name: 'COPY LINK' }).click();
  await expect(page.getByRole('status')).toHaveText('LINK COPIED TO CLIPBOARD');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('/writing/a-place-for-the-details/');
  await page.getByRole('navigation', { name: 'Table of contents' }).getByRole('link', { name: 'Follow the next thread' }).click();
  await expect(page).toHaveURL(/#follow-the-next-thread$/);
  await expect(page.locator('#follow-the-next-thread')).toBeInViewport();
  await expect(page.locator('#reading-progress-bar')).not.toHaveCSS('transform', 'matrix(0, 0, 0, 1, 0, 0)');
  await page.locator('.article-tags').getByRole('link', { name: '#journal' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('journal');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
});

test('all pages fit narrow and wide screens', async ({ page }) => {
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/writing/', '/about/', '/writing/a-place-for-the-details/', '/404.html']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      expect(sizes.document, `${path} at ${width}px`).toBeLessThanOrEqual(sizes.viewport);
    }
  }
});

test('primary pages have no automated accessibility violations in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto('/');
    await page.evaluate((value) => localStorage.setItem('zonkor-theme', value), theme);
    for (const path of ['/', '/writing/', '/about/', '/writing/a-place-for-the-details/']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations, `${path} in ${theme}`).toEqual([]);
    }
  }
});

test('RSS, metadata, and draft exclusion are correct', async ({ request }) => {
  const rss = await request.get('/rss.xml');
  expect(rss.ok()).toBeTruthy();
  expect(await rss.text()).toContain('A place for the details.');
  expect(await rss.text()).not.toContain('Your first research entry');
  const sitemap = await readFile('dist/sitemap-0.xml', 'utf8');
  expect(sitemap).toContain('https://zeyadzonkorany.github.io/writing/a-place-for-the-details/');
  expect(sitemap).not.toContain('your-first-research-entry');
  await expect(access('dist/writing/your-first-research-entry/index.html')).rejects.toThrow();
  const html = await readFile('dist/writing/a-place-for-the-details/index.html', 'utf8');
  expect(html).toContain('application/ld+json');
  expect(html).toContain('https://zeyadzonkorany.github.io/writing/a-place-for-the-details/');
});

test('articles remain readable without JavaScript and reduced motion stops the orbit', async ({ browser, page }) => {
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJs.newPage();
  await noJsPage.goto('http://127.0.0.1:4321/writing/a-place-for-the-details/');
  await expect(noJsPage.getByRole('heading', { name: 'What belongs here' })).toBeVisible();
  await noJsPage.getByRole('link', { name: 'Writing', exact: true }).click();
  await expect(noJsPage.locator('.archive-entry')).toBeVisible();
  await noJs.close();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.orbit-outer')).toHaveCSS('animation-duration', '1e-05s');
});
