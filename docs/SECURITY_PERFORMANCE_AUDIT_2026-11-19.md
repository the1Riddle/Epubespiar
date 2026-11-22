# Epubespiar security, browser integration and performance audit

**Review date:** November 19, 2026  
**Target:** `dev` branch  
**Implementation:** [Draft PR #2](https://github.com/the1Riddle/Epubespiar/pull/2)  
**Verification:** [Extension audit CI](https://github.com/the1Riddle/Epubespiar/actions/runs/44499318672) · [Chromium browser smoke test](https://github.com/the1Riddle/Epubespiar/actions/runs/44499318369)

## Executive summary

The audit branch builds and packages successfully on both browser targets, passes all eight Node regression tests, passes a real Chromium EPUB rendering/security smoke test, and reports **no known dependency advisories** in `pnpm audit`.

This is a **partially verified security hardening**, not a guarantee against arbitrary malicious EPUB files. The Firefox-specific restrictions and download-interception recovery paths still require follow-up.

## Verified measurements

| Measure | Before hardening (November 19 CI replay) | Audit branch (latest run) |
| --- | ---: | ---: |
| Chromium packaged ZIP | 139,410 bytes (136.14 KiB) | **138,276 bytes (135.04 KiB)** |
| Firefox packaged ZIP | 139,388 bytes (136.12 KiB) | **138,254 bytes (135.01 KiB)** |
| `pnpm audit` advisories | 11 (1 high, 9 moderate, 1 low) | **0 known** |
| Node regression tests | Not run in initial audit review | **8 passing** |
| Real Chromium EPUB security smoke test | Not run | **Passing** |
| Firefox native local-file integration test | Existing external probe evidence | **Not retested in this branch** |

The current compressed ZIP budget is 145,000 bytes per browser, enforced in CI. The previously reported 112 KiB release is historical and has not been reproduced against a comparable build configuration.

## Completed work

### Security

- Sanitized untrusted EPUB XHTML at the Shadow DOM boundary using the existing DOMPurify dependency. Shadow DOM alone does not prevent script execution.
- Strengthened extension Content Security Policy to prohibit external fonts/media/images, frames and forms, while retaining supported inline book styling.
- Added ZIP archive declared-size and entry-count preflight limits before inflating chapter entries.
- Added streaming response byte limits to prevent oversized HTTPS EPUB downloads with absent or misleading Content-Length.
- Corrected file MIME fallback for locally selected `.epub` books.
- Removed dead Base64 helpers inaccurately described as encryption.
- Removed unsupported `epub:` URL validation and redundant percent-decoding.
- Upgraded Vite from 5.4.21 to **6.4.6** and regenerated the pnpm lockfile.
- Pruned nine unused direct dependencies and reclassified build-only/runtime dependencies, eliminating the remaining known `glob`/`minimatch` advisory chain.

### Browser integration

- For Firefox `moz-extension://` pages, local `file://` EPUB download events no longer cancel a file that the extension page cannot read.
- Added browser policy regression tests and [Firefox guidance](FIREFOX_LOCAL_FILES.md).
- Kept Chromium and Firefox manifest builds separate and validated their referenced package assets.

### Performance and maintainability

- Centralized ownership of reader object URLs so resources are released on book close/replacement and failed imports.
- Changed IndexedDB bookshelf listing to return metadata rather than carrying every stored EPUB `File` into Vue's reactive state.
- Moved unreferenced icon SVG artwork out of the auto-published Vite `public` directory.
- Added per-browser ZIP-size reporting and a 145,000-byte CI size gate.
- Added reusable unit and real-browser security smoke test workflows.

## Verification evidence

- [November 19 final extension audit](https://github.com/the1Riddle/Epubespiar/actions/runs/44499318672): `pnpm install --frozen-lockfile`, 8 passing tests, Chrome/Firefox Vite builds, package validation, ZIP size budget, `pnpm audit` with no known advisories.
- [November 19 final Chromium smoke test](https://github.com/the1Riddle/Epubespiar/actions/runs/44499318369): launched unpacked Chromium extension, opened synthetic EPUB from file picker, displayed normal content, rejected inline scripts, inline event handlers and javascript: URLs, and confirmed injected JavaScript did not run.
- Browser testing with Chromium in the model's local container was blocked by a managed browser policy; the separate GitHub-hosted Playwright Chromium run supplies the real browser evidence.
- No real Firefox extension session, device-specific file opening, heap profiling, performance benchmarking, or authenticated download tests have been performed on this branch.

## Outstanding risks and next steps (priority order)

1. **HTTPS download recovery (high impact):** The background listener cancels some HTTPS downloads before proving that the reader can fetch the URL. Authenticated, expiring, redirected and one-time URLs can fail. Design non-destructive handoff/retry with a guaranteed recoverable download path; test race conditions, duplicated URLs and user-initiated downloads.
2. **EPUB renderer defense in depth:** DOMPurify sanitizes XHTML, but book CSS is retained for faithful styling and not yet independently parsed against a strict CSS URL/resource policy. Add malicious-CSS fixtures, verify CSP behavior, preserve authors' colors, and assess whether sandboxed iframes offer a better security tradeoff.
3. **ZIP-parser robustness:** Archive limits use JSZip's internal `_data.uncompressedSize` metadata. Pin/test JSZip compatibility, add real compressed-bomb fixtures, and enforce budgets on actual resource processing and image dimensions—not only declared ZIP sizes.
4. **Firefox real-device validation:** Confirm picker and reader-page drag/drop, HTTPS interception, the no-cancel local-file behavior, and browser-specific permission UX on current Firefox. Review [Mozilla 2085199](https://bugzilla.mozilla.org/show_bug.cgi?id=2085199) and [1617594](https://bugzilla.mozilla.org/show_bug.cgi?id=1617594). Do **not** assume the Firefox 153+ file-access opt-in permits extension-page `fetch(file://)`. Original [experimental findings](https://github.com/the1Riddle/see_the_difference/blob/main/docs/firefox-local-file-support.md).
5. **Long books and library performance:** The loader parses all spine items and the Vue reader eagerly renders all chapters; prototype incremental extraction and a bounded chapter window with preserved scroll/TOC behavior. Profile memory and timing before/after.
6. **Permissions/background lifecycle:** Reduce broad HTTPS content-script injection where capabilities permit, bound `allowedDownloads`/rate-limit state, and avoid treating all tabs as one rate-limit key.
7. **Package-size optimization:** Measure compressed contributions of Vue runtime, JSZip, DOMPurify, reader UI, CSS and icons. Preserve maintainability and features rather than sacrificing reader correctness for a fixed byte target.

## Merge recommendation

**Keep PR #2 as a draft.** The automated build and security gates are green, but HTTPS-download cancellation, Firefox native local-file integration and real-device compatibility remain important release-review concerns. Do not interpret the clean dependency report as proof that EPUB input handling is completely secure.
