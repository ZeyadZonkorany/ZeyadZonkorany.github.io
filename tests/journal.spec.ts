import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, access } from 'node:fs/promises';

const researchLinks = [
  ['When CSS Crosses the Boundary', 'https://zerosploit.co/resources/when-css-crosses-the-boundary'],
  ['Racing the Redirect: How HTTP 204 Preserved an XSS Sink', 'https://zerosploit.co/resources/racing-the-redirect-http-204-xss'],
];

test('dark is the default, navigation is separated, and the selected theme persists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('zonkor-theme', 'light'));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zonkor.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('heading', { name: 'Projects.' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'About', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About.');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('Research contains both credited source links and archive filters work', async ({ page }) => {
  await page.goto('/writing/');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(5);
  await page.getByRole('button', { name: 'Research 2' }).click();
  await expect(page.locator('.archive-entry:visible')).toHaveCount(2);
  for (const [title, href] of researchLinks) {
    const link = page.locator('.archive-list').getByRole('link', { name: title, exact: false });
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toContainText('ZeroSploit');
  }
  await page.getByRole('button', { name: 'CTF 2' }).click();
  await expect(page.locator('.archive-entry:visible')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('nothing-matches-this');
  await expect(page.getByRole('heading', { name: 'No articles found.' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('searchbox', { name: 'Search articles', exact: true }).blur();
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search articles', exact: true })).toBeFocused();
  await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('repository');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('nothing-matches-this');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(5);
  await page.goto('/writing/?category=Research&q=CSS');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Research 2' })).toHaveAttribute('aria-pressed', 'true');
});

test('both CTF articles are discoverable and link to the original writeups', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.locator('.ctf-preview')).toHaveCount(2);
  await page.locator('.ctf-preview[href="/writing/end/"]').click();
  await expect(page.locator('.article-header h1')).toHaveText('EnD — Sekai CTF 2026');
  await expect(page.locator('.article-source a')).toHaveAttribute('href', 'https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/Sekai%20CTF%202026/EnD/writeup.md');
  await expect(page.locator('.article-source')).toContainText('Complete writeup');
  await page.getByRole('button', { name: 'Copy code block' }).first().click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('K8s Pod');
  await page.getByRole('navigation', { name: 'Table of contents' }).getByRole('link', { name: 'Challenge Architecture', exact: true }).click();
  await expect(page.locator('#challenge-architecture')).toBeInViewport();
  await page.goto('/writing/?category=CTF');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('1nfin1ty');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
  await page.locator('.archive-entry:visible a').click();
  await expect(page.locator('.article-header h1')).toHaveText('1nfin1ty — 0xL4ugh CTF v5');
  await expect(page.locator('.article-source a')).toHaveAttribute('href', 'https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/0xL4ugh/1nfin1ty.md');
  await expect(page.locator('.article-source a')).toHaveAttribute('rel', 'noopener noreferrer');
});

test('site search supports shortcuts, results, keyboard selection, and focus return', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search the site' });
  const search = dialog.getByRole('searchbox');
  await expect(search).toBeFocused();
  await search.fill('CSS');
  await expect(dialog.getByRole('link')).toHaveCount(1);
  await expect(dialog.getByRole('link')).toHaveAttribute('href', researchLinks[0][1]);
  await search.fill('doesnotexist');
  await expect(dialog.getByText('No results found.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  await page.keyboard.press('Meta+k');
  await expect(dialog).toBeVisible();
  await search.fill('About');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.locator('.command-result.active')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/writing\/a-place-for-the-details\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About this blog');
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await search.fill('Projects');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/projects\/$/);
});

test('reading controls and article links work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/writing/a-place-for-the-details/');
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.locator('.toast')).toHaveText('Link copied to clipboard');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('/writing/a-place-for-the-details/');
  await page.getByRole('navigation', { name: 'Table of contents' }).getByRole('link', { name: 'Updates' }).click();
  await expect(page).toHaveURL(/#updates$/);
  await expect(page.locator('#updates')).toBeInViewport();
  await expect(page.locator('#reading-progress-bar')).not.toHaveCSS('transform', 'matrix(0, 0, 0, 1, 0, 0)');
  await page.locator('.article-tags').getByRole('link', { name: '#journal' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search articles', exact: true })).toHaveValue('journal');
  await expect(page.locator('.archive-entry:visible')).toHaveCount(1);
});

test('pages and search fit mobile, tablet, and desktop screens', async ({ page }) => {
  for (const width of [320, 360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/writing/', '/projects/', '/about/', '/writing/a-place-for-the-details/', '/writing/end/', '/writing/1nfin1ty/', '/404.html']) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
      expect(sizes.document, `${path} at ${width}px`).toBeLessThanOrEqual(sizes.viewport);
    }
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const rect = await page.locator('.command-menu').boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
  }
});

test('pages and search have no automated accessibility violations in both themes', async ({ page }) => {
  for (const theme of ['light', 'dark']) {
    await page.goto('/');
    await page.evaluate((value) => localStorage.setItem('zonkor-theme-v2', value), theme);
    for (const path of ['/', '/writing/', '/projects/', '/about/', '/writing/a-place-for-the-details/', '/writing/end/', '/writing/1nfin1ty/']) {
      await page.goto(path);
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(results.violations, `${path} in ${theme}`).toEqual([]);
    }
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations, `Search in ${theme}`).toEqual([]);
  }
});

test('feeds, metadata, source attribution, and draft exclusion are correct', async ({ request }) => {
  const rss = await request.get('/rss.xml');
  expect(rss.ok()).toBeTruthy();
  expect(await rss.text()).toContain('About this blog');
  expect(await rss.text()).toContain('EnD — Sekai CTF 2026');
  expect(await rss.text()).toContain('1nfin1ty — 0xL4ugh CTF v5');
  expect(await rss.text()).not.toContain('Your first research entry');
  expect(await rss.text()).not.toContain('When CSS Crosses the Boundary');
  const sitemap = await readFile('dist/sitemap-0.xml', 'utf8');
  expect(sitemap).toContain('https://zeyadzonkorany.github.io/projects/');
  expect(sitemap).toContain('https://zeyadzonkorany.github.io/writing/end/');
  expect(sitemap).toContain('https://zeyadzonkorany.github.io/writing/1nfin1ty/');
  expect(sitemap).not.toContain('your-first-research-entry');
  await expect(access('dist/writing/your-first-research-entry/index.html')).rejects.toThrow();
  const html = await readFile('dist/writing/a-place-for-the-details/index.html', 'utf8');
  expect(html).toContain('application/ld+json');
  expect(html).toContain('https://zeyadzonkorany.github.io/writing/a-place-for-the-details/');
  for (const path of ['dist/index.html', 'dist/writing/index.html', 'dist/about/index.html', 'dist/404.html', 'public/social.svg']) {
    const content = await readFile(path, 'utf8');
    expect(content).not.toMatch(/look closer|loose threads|asking why|stay curious|more to notice/i);
  }
});

test('the site remains readable without JavaScript and respects reduced motion', async ({ browser, page }) => {
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJs.newPage();
  await noJsPage.goto('http://127.0.0.1:4321/writing/a-place-for-the-details/');
  await expect(noJsPage.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(noJsPage.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  await noJsPage.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Writing', exact: true }).click();
  await expect(noJsPage.locator('.archive-entry')).toHaveCount(5);
  await expect(noJsPage.getByRole('button', { name: 'Search', exact: true })).toHaveCount(0);
  await expect(noJsPage.locator('.archive-controls')).not.toBeVisible();
  await noJs.close();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
});
