# Firefox: local EPUB files and browser integration

## Current limitation

On Firefox 158.0.1 (Windows 10), Epubespiar can detect a local `.epub`
download and open its extension reader, but a `moz-extension://` reader page
cannot fetch the original `file://` URL. The Firefox 153+ **Access local
files on your computer** opt-in does **not** lift this restriction for
extension-page `fetch()`/XHR in the tested configuration.

The underlying permission and resource-loading questions are tracked upstream:

- [Mozilla bug 2085199](https://bugzilla.mozilla.org/show_bug.cgi?id=2085199):
  extension-page `fetch()`/XHR of local files, even with permission granted.
- [Mozilla bug 1617594](https://bugzilla.mozilla.org/show_bug.cgi?id=1617594):
  explicit permission for extension-created local file navigation. Navigation
  and extension-page resource fetching are different capabilities.
- [Mozilla bug 2034168](https://bugzilla.mozilla.org/show_bug.cgi?id=2034168):
  explicit local file access opt-in (shipped in Firefox 153).

See the [original reproduction and investigation](https://github.com/the1Riddle/see_the_difference/blob/main/docs/firefox-local-file-support.md)
for detailed results.

## Supported ways to open a local EPUB on Firefox

1. Use **Open EPUB** in the reader to select the local file.
2. Drag the actual `.epub` file onto the already-open reader page.

Both paths provide a browser `File` object directly to the EPUB parser. Neither
requires a `moz-extension://` page to fetch a `file://` resource.

Opening a `file://` EPUB through a browser download interception event is **not**
a supported path on Firefox at present. To avoid losing the original action,
the background handler does not cancel such downloads on Firefox.

## Chromium differences

Chromium provides a different extension-page local-file access model. Local
file support remains conditional on browser settings, installed-extension
permissions, and the user's chosen operation.

## Regression checklist

- Firefox: picker and file-drop onto reader both import EPUBs.
- Firefox: local file download is **not cancelled** by the extension.
- Firefox: HTTPS EPUB opening and optional download interception still work.
- Chromium: with file URL access disabled, the original local download continues. Enable file URL access and verify that a local EPUB opens in the reader.
- Both: unreadable/invalid ZIPs fail gracefully, never execute active XHTML.
- Recheck bugs 2085199 and 1617594 before changing the Firefox policy.

These are documented expectations; automated tests do not substitute for
manual native-browser validation.
