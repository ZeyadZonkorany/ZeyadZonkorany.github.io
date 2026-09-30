---
title: "EnD — Sekai CTF 2026"
description: "A reading proxy, an internal API, and an admin bot. A challenge about HTTP framing and the browser boundaries between them."
date: 2026-06-29
updated: 2026-09-30
category: CTF
event: Sekai CTF 2026
cover: end
source:
  url: "https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/Sekai%20CTF%202026/EnD/writeup.md"
  label: "Original EnD writeup"
tags: [web, http, nodejs, chromium, service-workers]
draft: false
---

EnD is a web challenge I wrote for **Sekai CTF 2026**. Its application, ReadView, is a reading proxy: register an external URL and view its content through the proxy's own interface.

The interesting part is how that simple feature connects several different systems. There is a Node.js proxy, a Flask API, and a Puppeteer admin bot. Each has its own view of what a request or response means.

This article is an edited overview of the challenge and its main ideas. The [original writeup](https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/Sekai%20CTF%202026/EnD/writeup.md) contains the complete solution.

## Why I made this challenge

CTFs have always been a place to learn something new and explore different ways of thinking. I prefer challenges that reward research and creativity, even if that means having fewer challenges in a category.

That also shapes how I think about LLMs. They are useful for following code paths, finding relevant material, and helping with the early stages of research. The harder part is understanding unfamiliar internals and connecting ideas across different systems.

In EnD, participants needed to look at both Node.js response handling and Chromium behavior. Once those pieces were understood, AI could help connect the findings. That is the role I think it should play: a research tool that still needs direction.

## The application

All three services share the network namespace of one Kubernetes pod. From the bot's perspective, the proxy and the API are both local services.

```text
One Kubernetes pod · shared network namespace

Node.js proxy       Flask API          Puppeteer bot
    :3000             :9090                 :8000
```

| Component | Responsibility |
| --- | --- |
| Proxy | Register external pages and serve them through ReadView |
| API | Store messages and answer authenticated searches |
| Bot | Visit submitted pages with an admin session |

The proxy applies a Content Security Policy, restricts script responses, and checks DNS results to reject private addresses. The API has a separate authentication key. The admin interface provides the configuration the bot is allowed to see.

These controls protect different boundaries. Understanding the challenge means looking at what each control actually governs.

## HTTP framing is part of the boundary

The first issue concerns the difference between changing a response's headers and changing the response that is actually sent.

The proxy's script restriction changes response metadata while the upstream body is still being forwarded. That creates a disagreement between the declared message boundary and the underlying stream. With persistent HTTP connections, message boundaries matter beyond a single response.

The important observation is that the application and the HTTP parser do not necessarily interpret the same bytes in the same way. The original writeup follows this through Node.js's outgoing response implementation.

## Cross-origin responses can still reveal behavior

The next part moves from the proxy to the browser. A cross-origin response can be opaque to JavaScript while still affecting observable browser behavior.

EnD uses an API whose search results have different response sizes. HTTP Range support, media loading, and Service Worker response handling interact with those differences. The Chromium issue referenced in the original writeup concerns a side channel in that interaction.

This is a useful distinction when studying browser security: hiding response contents does not automatically make every effect of that response unobservable.

## What connects the two parts

The challenge combines an HTTP interpretation problem with a browser response-handling problem. Neither is fully described by reading the Flask search function or the proxy's access checks in isolation.

The useful questions are:

- Do response headers describe the bytes the proxy actually sends?
- Which service's authority does the browser attach to a response?
- What can the browser expose about a response whose contents remain unreadable?
- Which assumptions change when an automated browser runs beside internal services?

Those are the boundaries the challenge was designed to make participants investigate.

## Sources

- [Original EnD writeup](https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/Sekai%20CTF%202026/EnD/writeup.md)
- [Chromium issue 474435504](https://issues.chromium.org/issues/474435504)
- [Node.js outgoing response implementation referenced in the writeup](https://github.com/nodejs/node/blob/ed6f45bef86134533550924baa89fd92d5b24f78/lib/_http_outgoing.js#L587)
