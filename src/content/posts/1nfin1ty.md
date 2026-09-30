---
title: "1nfin1ty — 0xL4ugh CTF v5"
description: "A note-taking app with two privileged bots. Following its boundaries through character encodings, error documents, and Firefox internals."
date: 2026-06-29
updated: 2026-09-30
category: CTF
event: 0xL4ugh CTF v5
cover: infinity
source:
  url: "https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/0xL4ugh/1nfin1ty.md"
  label: "Original 1nfin1ty writeup"
tags: [web, browsers, encoding, dompurify, firefox]
draft: false
---

1nfin1ty is a web challenge built around a note-taking application and a chain of privileged browser visits. Users can submit URLs to an admin, and the admin has a separate way to request a visit from a superadmin.

The challenge's flag is a file in the superadmin's environment. Reaching the ordinary admin interface is only one part of the problem; the browser and storage behavior in the final environment matter too.

This article is an edited overview of the challenge's architecture and the concepts behind its solution. The [original writeup](https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/0xL4ugh/1nfin1ty.md) contains the complete walkthrough and screenshots.

## Three levels of authority

The application's structure is easier to understand when the roles are separated:

```text
User
  └─ submits a URL to the admin
       └─ can request a visit from the superadmin
            └─ has a separate browser environment
```

| Role | Environment and constraints |
| --- | --- |
| User | Creates notes and submits URLs |
| Admin | Visits submitted content using Chromium |
| Superadmin | Uses Firefox in a separate privileged environment |

The admin-to-superadmin endpoint requires a separate access key. Notes are sanitized, the admin's session cookie is HttpOnly, and note content has a short length limit.

This makes the challenge about how several controls fit together, rather than about one exposed endpoint.

## Sanitization and character encodings

The original analysis looks at the relationship between the string seen by DOMPurify and the document eventually interpreted by the browser.

If those stages disagree about character encoding, a sanitizer's view of the markup can differ from the browser's view. The application's HTML responses make that distinction relevant to the challenge.

The writeup links to SonarSource's research on encoding differentials and records the exact Chromium build used by the admin bot. Browser versions are part of the setup, so observations from the challenge should be understood in that context.

## Error documents have their own behavior

Another part of the analysis concerns requests that never reach the application's ordinary response handlers.

An application can close a connection for a route while another layer of the server still produces an error response. That response has its own headers and its own treatment by the browser.

The challenge examines how those error documents relate to the site's origin. It is a reminder that the security behavior of a page includes responses produced outside the handler that developers normally inspect.

## Short input is still browser input

The note length limit constrains the text stored in a note. It does not describe every other piece of state involved in a browser visit.

The writeup considers navigation and browsing-context state alongside the note itself. That broader view matters when judging what an input limit actually protects: the stored string is only one part of the resulting browser environment.

## The Firefox stage

The superadmin runs a different browser with a persistent profile directory. This brings two more areas into the analysis: Firefox's handling of errors and its on-disk storage of site data.

The original writeup references Mozilla bug 1960745, concerning information exposure through error handling. It also examines origin attributes and IndexedDB storage in the profile.

These details connect browser-level isolation with operating-system files. Data that begins as a web storage object also has a representation on disk, and that representation matters in an environment with persistent browser state.

## What the challenge brings together

The solution crosses multiple layers: sanitized HTML, document decoding, server-generated error responses, automated browser visits, and profile storage.

The main lesson is to follow the assumptions between those layers. A sanitizer, a cookie setting, a short-input check, and a browser preference each address a specific concern. Understanding the whole application requires understanding their interaction.

The original article includes screenshots of the intermediate observations. It also documents the browser versions and references used during the research.

## Sources

- [Original 1nfin1ty writeup and screenshots](https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/0xL4ugh/1nfin1ty.md)
- [SonarSource: encoding differentials and character sets](https://www.sonarsource.com/blog/encoding-differentials-why-charset-matters/)
- [Mozilla bug 1960745](https://bugzilla.mozilla.org/show_bug.cgi?id=1960745)
- [Firefox origin attributes](https://searchfox.org/firefox-main/source/caps/OriginAttributes.h)
