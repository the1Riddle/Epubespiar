# EPUB download handoff and preview recovery

## Browser download UX

The reader's download button now asks the background extension to call the
browser's native `downloads.download()` API for the **original HTTPS source**.
It does not fetch the entire book into a JavaScript Blob, use an artificial
blob filename, or assert completion before the browser has received data.

The background verifies that the message comes from `reader.html` and that
its `file` query value is exactly the requested source URL. This permits
opaque URLs such as `/download/99021521` but rejects requests sent by content
scripts on unrelated websites.

A short-lived allowance plus a tracked download ID prevents the browser's own
download from being intercepted again when it emits `onCreated`, `onChanged`,
or a delayed filename/MIME update.

The reader checks the returned download ID via `downloads.search()`:
1. Initially the toolbar arrow is static and duplicate clicks are disabled.
2. **After 3 seconds without received bytes**, the arrow moves downward and
   pulses, with `prefers-reduced-motion` respected.
3. On the first received bytes or completion, the reader reports **started**
   (not **finished**), clears the animation, and lets the browser's downloads
   UI handle the remaining transfer.
4. On an interrupted download, the failure reason is displayed to the user.
5. If the browser still has not received data after approximately 90 seconds,
   the reader displays a *still waiting* notice, without cancelling the
   browser-owned download or inventing a successful transfer.

`downloads.onChanged` does not report `bytesReceived`; observing this field
requires `downloads.search()`.

## Recover from failed online previews

Preview fetching retries up to two times for transient failures, including
a response that starts with HTTP 200 but breaks **during streaming**.
Authorization or missing-file HTTP errors and resource-limit violations
are not retried indefinitely.

If an intercepted preview still fails, the reader keeps the source URL and
offers **Retry preview** and **Download with browser**. This avoids a mandatory
page reload and lets users attempt the normal download route.

**Important limitation:** after interception cancels the original download,
a one-time or expired server URL may no longer be reusable. The recovery
controls cannot restore credentials or an already invalidated link. The
interceptor does open the reader tab *before* cancelling the original transfer,
so tab-creation failures no longer destroy an otherwise valid download.

## EPUB archive validation

The ZIP-bomb preflight now reads the **standard ZIP central directory** rather
than depending on the private JSZip `_data.uncompressedSize` implementation.
The existing 2,500-entry, 64-MiB-per-entry, and 256-MiB-total declared expanded
size limits remain enforced. Multi-disk, ZIP64, and encrypted archives are
rejected. This eliminates the `EPUB archive has unsupported size metadata`
false rejection for normal EPUB ZIPs.

The user-supplied `113374727.epub` (about 7.2 MiB compressed and 8.0 MiB
expanded, 64 ZIP members) passed local ZIP integrity and central-directory
checks and could be opened by JSZip 3.10.1. **The book itself is not committed
to this repository.**

## Test checklist

- [ ] Open an intercepted EPUB whose URL ends with `.epub`
- [ ] Open an intercepted EPUB from an opaque `/download/<id>` URL
- [ ] Start a fast download: no distracting arrow animation
- [ ] Delay the response for over three seconds: arrow animates
- [ ] Confirm first received bytes stop the animation
- [ ] Simulate network interruption: no false success message
- [ ] Retry preview after failed headers **and** failed body stream
- [ ] Confirm Chrome and Firefox don't re-intercept their own downloads
- [ ] Open the previously rejected EPUB using a real browser build
- [ ] Compare the compressed ZIP budgets for both browser packages

Unit coverage is in `tests/security-regression.test.mjs` and
`tests/download-regression.test.mjs`. The extension's Chromium smoke workflow
continues to cover reader rendering and EPUB asset sanitization.
