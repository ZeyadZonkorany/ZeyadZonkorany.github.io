# Zonkor’s research journal

A custom editorial blog for security research, CTF writeups, and field notes.

**Site address:** https://zeyadzonkorany.github.io

## Publishing status

The source and the built website have been pushed to GitHub. The first hosted deployment was blocked before it started with: “The job was not started because your account is locked due to a billing issue.” See the [deployment run](https://github.com/ZeyadZonkorany/ZeyadZonkorany.github.io/actions/runs/36628612196).

The custom workflow has been disabled temporarily. A direct branch deployment was requested using the built files on `gh-pages`, with a `.nojekyll` file. That deployment’s final status has not yet been verified.

After the GitHub billing issue is resolved, choose **Settings → Pages → Source → GitHub Actions**, re-enable **Publish research journal** in the Actions tab, and run it once. Later edits to `main` will publish automatically.

## Write an article

Once automatic deployment is enabled, you can publish directly from GitHub:

1. Open `src/content/posts/` and choose **Add file → Create new file**.
2. Give it a short name ending in `.md`, such as `my-research.md`.
3. Copy the structure from `templates/post.md` and write your article in Markdown.
4. Set `draft: false`, choose a date, and commit the file to `main`.
5. GitHub Actions rebuilds and publishes the blog automatically.

Example article metadata:

```yaml
---
title: "Your research title"
description: "A short summary of the question and what you found."
date: 2026-09-29
category: Research
tags: [web-security, browsers]
featured: true
draft: false
---
```

Categories are `Research`, `CTF`, or `Notes`. Set `featured: true` to feature an entry on the homepage; if several are featured, the newest is shown. A future date or `draft: true` excludes a post from the published site, RSS, and sitemap. This repository is public, so committed source files are still visible on GitHub; keep unpublished sensitive material outside the repository.

Articles support headings, tables, images, links, blockquotes, and highlighted code blocks. The table of contents and estimated reading time are automatic. Code blocks have a copy button. Put images in `public/images/` and reference them as `![Descriptive alt text](/images/my-diagram.png)`.

## Work locally

Requires Node.js 22.12 or later.

```sh
npm ci
npm run dev
```

Create a new article with:

```sh
npm run new-post -- "Your research title"
```

The command creates a draft and refuses to overwrite an existing file.

```sh
npm run check
npm run build
npm run preview
```

## Publish the built files locally

When Pages is configured to publish from the `gh-pages` branch at `/ (root)`, use:

```sh
npm run publish
```

This checks and builds the journal, copies the generated files into a temporary checkout, and pushes to `gh-pages` without a force push. It does not change your article checkout. GitHub still needs to accept the Pages deployment; this command does not resolve an account billing lock.

To prepare and validate the files without accessing GitHub or pushing:

```sh
npm run publish -- --prepare-only
```

## Design and structure

- `src/styles/global.css` — colors, typography, responsive layout, and motion.
- `src/layouts/Base.astro` — shared navigation, footer, metadata, and theme.
- `src/components/Diagram.astro` — the custom orbital illustration.
- `src/pages/index.astro` — homepage and selected public projects.
- `src/pages/about.astro` — personal profile and links.
- `src/content/posts/` — article source files.
- `src/scripts/site.ts` — search, filters, theme, copy controls, and reading progress.
- `scripts/publish.mjs` — local publishing of the built site to `gh-pages`.
- `.github/workflows/deploy.yml` — automatic GitHub Pages deployment.

The fonts are self hosted. There are no analytics, external font requests, or framework hydration. Motion respects the reader’s reduced motion preference. The journal remains readable with JavaScript disabled.

## Browser checks

```sh
npx playwright install chromium
npm test
```

The suite checks navigation, filtering, themes, mobile layout, accessibility, article controls, feeds, and publication rules.
