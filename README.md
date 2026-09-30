# Zonkor’s research journal

A custom dark blog for security research, CTF writeups, and technical notes, with separate pages for writing, projects, and a profile.

**Live site:** https://zeyadzonkorany.github.io

## Publishing status

The blog is live. GitHub Pages publishes the built files from `gh-pages`, with a `.nojekyll` file. The [direct Pages deployment](https://github.com/ZeyadZonkorany/ZeyadZonkorany.github.io/actions/runs/36636520816) succeeded, and the public homepage returned HTTP 200 on September 30, 2026 (Cairo time).

To publish an article now, edit its Markdown source, set `draft: false`, and run `npm run publish` locally. That command checks and builds the journal, then pushes the generated website to the publishing branch.

The custom hosted build workflow is temporarily disabled. Its [first deployment](https://github.com/ZeyadZonkorany/ZeyadZonkorany.github.io/actions/runs/36628612196) was blocked by a GitHub account billing issue. This does not prevent the current direct Pages deployment from serving the blog.

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

Categories are `Research`, `CTF`, or `Notes`. The homepage shows the two newest Research articles or external research references. A future date or `draft: true` excludes a post from the published site, RSS, and sitemap. This repository is public, so committed source files are still visible on GitHub; keep unpublished sensitive material outside the repository.

Articles support headings, tables, images, links, blockquotes, and highlighted code blocks. The table of contents and estimated reading time are automatic. Code blocks have a copy button. Put images in `public/images/` and reference them as `![Descriptive alt text](/images/my-diagram.png)`.

The CTF section includes the complete original Markdown for **EnD** and **1nfin1ty** from `MY-CTF-CHALLENGES`, including their screenshots, code blocks, explanations, and references. The blog adds only the frontmatter required for routing, metadata, custom covers, and links back to GitHub. The publication dates come from that repository's June 29, 2026 commits. Optional article metadata includes `event`, `cover` (`note`, `ctf`, `web`, `end`, or `infinity`), and `source` with a `url` and `label`. The two newest CTF posts appear below Research on the homepage.

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

This checks and builds the journal, copies the generated files into a temporary checkout, and pushes to `gh-pages` without a force push. It does not change your article checkout. GitHub Pages publishes the branch after the push. Source changes should also be committed and pushed to `main` so they are saved on GitHub.

To prepare and validate the files without accessing GitHub or pushing:

```sh
npm run publish -- --prepare-only
```

## Design and structure

- `src/styles/site.css` — colors, typography, responsive layout, and motion.
- `src/layouts/Base.astro` — shared navigation, footer, metadata, and theme.
- `src/pages/index.astro` — custom masthead and the newest research.
- `src/components/Wordmark.astro` and `src/lib/identity.ts` — the original stencil lettering.
- `src/components/Poster.astro` — vector cover artwork for research and projects.
- `src/pages/projects.astro` — public challenge repositories.
- `src/lib/references.ts` — attributed external resources listed under Research.
- `src/pages/about.astro` — personal profile and links.
- `src/content/posts/` — article source files.
- `src/scripts/hero.ts` — the local 3D ribbon, drawn on canvas with pointer and scroll input.
- `src/scripts/site.ts` — site search (Cmd/Ctrl+K), archive filters, theme, copy controls, and reading progress.
- `scripts/publish.mjs` — local publishing of the built site to `gh-pages`.
- `.github/workflows/deploy.yml` — automatic GitHub Pages deployment.

The design uses a custom stencil wordmark, warm copper and olive colors, and an asymmetric research layout. The compact homepage wordmark reveals a second ink color under the pointer; cover artwork shifts slightly on hover. A small extruded Z responds to pointer movement and scroll. It renders locally, needs no video download, and stops rendering when its motion settles. These decorative effects are disabled for reduced motion and do not affect touch navigation.

Dark mode is the default. The optional light theme persists across pages. Research references link directly to the original publisher; they are not republished as local articles or included in the article RSS feed.

The fonts are self hosted. There are no analytics, external font requests, or framework hydration. Motion respects the reader’s reduced motion preference. The journal remains readable with JavaScript disabled.

## Browser checks

```sh
npx playwright install chromium
npm test
```

The suite checks navigation, filtering, themes, mobile layout, accessibility, article controls, feeds, and publication rules.
