---
title: "EnD — Sekai CTF 2026"
description: "The complete EnD writeup: HTTP response splitting, admin access, and a Chromium Range response side channel."
date: 2026-06-29
updated: 2026-09-30
category: CTF
event: Sekai CTF 2026
cover: end
source:
  url: "https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/Sekai%20CTF%202026/EnD/writeup.md"
  label: "View EnD on GitHub"
tags: [web, http, nodejs, chromium, service-workers]
draft: false
---

# EnD

**Category:** Web  
**Difficulty:** ⭐⭐⭐⭐  
**Author:** zonkor


## POV about LLM

So, the last couple of months there has been so much talk about LLMs, how strong they are, how they are able to solve challenges, and AI security overall.

People keep talking about how they find bugs, CVEs, and 0-days. But not every CVE or 0-day is that hard. Most of them are source to sink discoveries, memory crashes, or unsanitized inputs that reach dangerous sinks. LLMs have definitely become much better at this kind of work.

But I don't think that's the right way to measure how far AI has actually reached.

AI is really good at tracing code, following execution paths, and using the huge amount of knowledge it was trained on. It has become much better at reasoning too, but it still struggles with something important: novelty and creativity. The hard part isn't tracing what's already there it's dealing with internals, connecting different concepts together, and coming up with something new.

That's also why I don't think most of the CTFs over the last few months were a good benchmark for AI. Most of them weren't even intermediate-level challenges. They were guessy or very direct, the kind of things AI will definitely get.

CTFs have never just been about getting the flag. They've always been a place where people learn new things, discover techniques they didn't know before, and explore different ways of thinking. :)

The best CTFs are the ones that push research and creativity. Even if there are only two challenges in each category, I'd rather have two really creative challenges than ten straightforward ones.

AI is a tool that all of us should use. It's really good at covering the first stages of research and helping us move faster. But after that, in these kinds of challenges, we still need to direct it.

For example, in my challenge, people first reached the Chromium issues and the Node.js internals around handling responses. Once they understood those pieces, AI became useful for helping them connect everything together. That's exactly the role I think AI should play.

## Overview

The challenge presents a "ReadView" application — a reading proxy that lets users register external URLs and view them under `/view/<name>/`. There's an admin bot with a session cookie, an internal Flask API on port 9090 that holds the flag, and a Node.js proxy on port 3000 that ties everything together.

From the admin's perspective the whole instance lives on localhost — proxy at `http://localhost:3000`, API at `http://localhost:9090`. All three services (proxy, API, bot) run in the same K8s pod so they share the network namespace.

The goal is to leak the flag from the API's `/messages/search` endpoint, which requires a valid API key that only the admin can see on `/admin`.

## Challenge Architecture

```
┌────────────────────────────────────────────────┐
│  K8s Pod (shared localhost)                    │
│                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  Proxy   │  │   API    │  │     Bot      │ │
│  │ :3000    │  │  :9090   │  │    :8000     │ │
│  │ Node.js  │  │  Flask   │  │  Puppeteer   │ │
│  └──────────┘  └──────────┘  └──────────────┘ │
└────────────────────────────────────────────────┘
```

**Proxy** (`proxy/app.js`):
- Registers user-submitted public URLs under `/view/<name>/`
- Proxies requests to those URLs, but applies a strict CSP and blocks scripts via `sec-fetch-dest`
- Serves an admin panel at `/admin` (requires session cookie) showing the API URL and API key
- SSRF protection: DNS resolution check blocks private/internal IPs

**API** (`api/app.py`):
- Stores the flag in `_INBOX`
- `/messages/search?q=<prefix>&key=<apikey>` — returns messages whose content starts with the given prefix
- Uses `flask.send_file` with `conditional=True` — this is important, it enables HTTP Range request support
- Host header check: only allows `api`, `localhost`, `127.0.0.1`

**Bot** (`bot/bot.js`):
- Visits user-submitted URLs with the admin session cookie set on the proxy's origin
- Uses `--unsafely-treat-insecure-origin-as-secure` for the submitted URL's origin
- 2 minutes of browser time per visit


## Step 1: HTTP Response Splitting via Node.js `sec-fetch-dest` Defense

The proxy has an interesting defense mechanism when proxying responses:

```javascript
if (req.headers['sec-fetch-dest'] === 'script') {
    h['content-length'] = '0'
    delete h['transfer-encoding']
}
```

When a request has `Sec-Fetch-Dest: script`, the proxy sets `Content-Length: 0` on the response headers before writing them. The idea is to block any scripts from loading through the proxy — the browser gets an empty body.

But here's the thing: the proxy still pipes the full upstream response body into the socket:

```javascript
res.writeHead(proxyRes.statusCode, proxyRes.statusMessage, h)
proxyRes.pipe(res)
```

The `Content-Length: 0` tells the HTTP/1.1 parser the response body is empty, but the actual bytes still flow down the TCP connection. The browser's HTTP stack reads `Content-Length: 0`, considers that response done, and then the leftover bytes sit in the socket buffer. If another request reuses this connection, those leftover bytes get parsed as the beginning of the *next* HTTP response.

This is classic HTTP response splitting / desync. And Node.js `_http_outgoing.js` explicitly allows writing body data even when `Content-Length: 0` is set — it doesn't enforce the mismatch. See [the relevant Node.js source](https://github.com/nodejs/node/blob/ed6f45bef86134533550924baa89fd92d5b24f78/lib/_http_outgoing.js#L587).

### Triggering it

We register our attacker server as a page (`/add?name=<name>&url=http://attacker/`), then load it through the proxy at `/view/<name>/`. Our server returns a page with multiple `<script async>` tags:

```html
<script async src="s1.js"></script>
<script async src="s2.js"></script>
...
<script async src="s8.js"></script>
```

These all go through the proxy (`/view/<name>/s1.js`, etc). The browser sends `Sec-Fetch-Dest: script` for each one. Our server handles one of them (say `s6.js`) specially:

1. Send a response with `Content-Type: not/script` and a `Content-Length` matching the size of our smuggled payload, plus `Expect: 100-continue`
2. Wait ~500ms for the proxy to write `Content-Length: 0` and flush headers
3. Then write a **raw HTTP response** directly to the socket — our smuggled JavaScript wrapped in proper HTTP response headers

```
HTTP/1.1 200 OK
Content-Type: application/javascript
Content-Length: <size of JS>
Connection: keep-alive

<our malicious JS here>
```

The proxy's `Content-Length: 0` on the outer response means the browser considers that response done. The smuggled bytes remain in the connection. The other `<script>` tags that are still pending get assigned to the same HTTP/1.1 connection (pool exhaustion — all other slots are occupied by the slow-responding s1-s5, s7-s8 requests), and the browser parses our smuggled bytes as their response. Now our JavaScript executes on the proxy's origin.

## Step 2: Reading the Admin Page

Once we have XSS on the proxy origin, it's straightforward:

```javascript
var page = await fetch('/admin', { credentials: 'include' }).then(r => r.text());
var key = (page.match(/id="api-key">([^<]+)/) || [])[1];
var url = (page.match(/id="api-url">([^<]+)/) || [])[1];
```

The bot has the admin session cookie set on the proxy's hostname. Our smuggled JS runs on that same origin, so `credentials: 'include'` sends the cookie along. We parse the API key and API URL from the admin page HTML.

## Step 3: The Oracle — Chromium Range Request Side Channel

Now we have the API key and we know the API endpoint. The API's search endpoint does prefix matching:

```python
results = [m for m in _INBOX if m.startswith(q)]
```

And it serves results with `conditional=True` in `send_file`, which enables Range request support. When a match is found, the response body contains the matching messages (non-empty). When nothing matches, the body is `{"results": []}` (smaller).

The key insight is that **Chromium handles Range responses differently for `<audio>` elements based on the response body size**, and this behavior leaks through opaque (cross-origin) responses in a Service Worker context. This is [CVE / Chromium Issue 474435504](https://issues.chromium.org/issues/474435504)

### How the Range oracle works

1. Create an `<audio>` element pointing to the API search endpoint
2. The Service Worker intercepts the initial `Range: bytes=0-` request and responds with a fake `206 Partial Content` claiming the resource is large
3. Chromium then issues a second range request `Range: bytes=<N>-` to get the rest
4. The SW intercepts this second request, forwards it to the actual API, and stores the response
5. Later, we try to reuse that stored opaque response in a normal fetch context
6. Here's the leak: if the API returned a real match (content exists, `206`), replaying it in a non-range context causes a network error (fetch rejects). If there was no match (shorter response, `416 Range Not Satisfiable`), the replay succeeds (fetch resolves)
7. This gives us a boolean oracle: does the flag start with prefix `q`?

## Step 4: Putting It All Together

The solver runs an HTTP server on the attacker's VPS:

1. **Register** a page on the proxy pointing to our VPS
2. **Submit** our trigger URL to the bot — the trigger page opens a `window.open` to the proxy page (so the bot's admin cookie applies on the proxy origin), then holds the page open with a slow-loading image
3. **Smuggled JS executes** on the proxy origin — reads `/admin`, extracts the API key
4. **Opens a new window** to the attacker's VPS at `/oracle.html?key=...&api=...`
5. **Oracle page** registers a Service Worker on the attacker origin, then starts the character-by-character leak against the API
6. Each found character is reported back to the VPS via image beacons
7. If the bot's 2-minute timeout hits before the full flag is leaked, the solver resubmits the bot with the progress so far as prefix and continues from where it left off

## References

- [Chromium Issue 474435504](https://issues.chromium.org/issues/474435504) — Range response handling side channel in Service Workers
- [maple3142 — Private Browsing+ (HITCON CTF 2024)](https://github.com/maple3142/My-CTF-Challenges/tree/master/HITCON%20CTF%202024/Private%20Browsing+) 
- [Node.js `_http_outgoing.js` L587](https://github.com/nodejs/node/blob/ed6f45bef86134533550924baa89fd92d5b24f78/lib/_http_outgoing.js#L587) — Node.js does not prevent writing body data when Content-Length is set to 0, enabling the response splitting
