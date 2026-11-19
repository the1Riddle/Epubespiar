"""Chromium extension smoke tests using the built unpacked MV3 extension.

Runs on GitHub Actions with Playwright's extension-capable Chromium build.
Never includes a malicious fixture outside the local throwaway browser profile.
"""
from pathlib import Path
import os
import tempfile
import zipfile
import struct
import zlib
from playwright.sync_api import sync_playwright

DIST = (Path(__file__).resolve().parents[1] / "dist" / "chrome").resolve()


def fixture_png():
    """Generate a standards-compliant one-pixel RGB PNG with no external dependencies."""
    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff))

    signature = b"\\x89PNG\\r\\n\\x1a\\n"
    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = zlib.compress(b"\\x00\\xff\\x50\\x20")
    return (signature + chunk(b"IHDR", header) + chunk(b"IDAT", pixels)
            + chunk(b"IEND", b""))


def write_epub(path: Path, malicious: bool = False):
    chapter = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Safe Chapter</title></head>
  <body><h1>Reader security fixture</h1><p>Hello, Epubespiar.</p>
  <img id="test-cover" src="cover.png" alt="cover"/>
  <img id="test-illustration" src="images/illustration.png" alt="illustration"/>
  <img src="unavailable.png" onerror="window.__epubespiar_xss = true"/>
  <script>window.__epubespiar_xss = true</script>
  <a href="javascript:window.__epubespiar_xss = true">Click here</a>
  </body>
</html>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("mimetype", "application/epub+zip",
                         compress_type=zipfile.ZIP_STORED)
        archive.writestr(
            "META-INF/container.xml",
            """<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="EPUB/book.opf"
      media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>""",
        )
        archive.writestr(
            "EPUB/book.opf",
            """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"
 unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="id">epubespiar-security-fixture</dc:identifier>
  <dc:title>Security fixture</dc:title>
  <dc:creator>Audit</dc:creator>
</metadata>
<manifest>
  <item id="one" href="chapter.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="one"/></spine>
</package>""",
        )
        archive.writestr("EPUB/chapter.xhtml", chapter)
        archive.writestr("EPUB/cover.png", fixture_png())
        archive.writestr("EPUB/images/illustration.png", fixture_png())


def main():
    assert DIST.is_dir(), "Build Chrome extension before running smoke tests"
    with tempfile.TemporaryDirectory(prefix="epubespiar-smoke-") as directory:
        root = Path(directory)
        book = root / "hostile.epub"
        write_epub(book)
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(root / "profile"),
                channel="chromium",
                headless=True,
                args=[
                    f"--disable-extensions-except={DIST}",
                    f"--load-extension={DIST}",
                ],
            )
            try:
                if context.service_workers:
                    worker = context.service_workers[0]
                else:
                    worker = context.wait_for_event("serviceworker", timeout=20000)
                extension_id = worker.url.split("/")[2]
                assert worker.url.startswith("chrome-extension://")

                page = context.new_page()
                # Trace object URL ownership without changing the extension code.
                page.add_init_script("""(() => {
                  window.__epubAssetBlobs = new Map();
                  window.__epubAssetRevoked = [];
                  const create = URL.createObjectURL.bind(URL);
                  const revoke = URL.revokeObjectURL.bind(URL);
                  URL.createObjectURL = blob => {
                    const url = create(blob);
                    window.__epubAssetBlobs.set(url, blob);
                    return url;
                  };
                  URL.revokeObjectURL = url => {
                    window.__epubAssetRevoked.push(url);
                    revoke(url);
                  };
                })();""")
                errors = []
                page.on("pageerror", lambda exc: errors.append(str(exc)))
                image_diagnostics = []
                page.on("console", lambda msg: image_diagnostics.append(f"{msg.type}: {msg.text}"))
                page.on("requestfailed", lambda req: image_diagnostics.append(
                    f"failed request: {req.url} ({req.failure})"
                ))
                page.goto(f"chrome-extension://{extension_id}/reader.html")
                page.locator("input[type=file]").first.set_input_files(
                    str(book), timeout=15000
                )
                host = page.locator(".chapter-content-host").first
                host.wait_for(state="visible", timeout=25000)
                content = host.evaluate("(el) => el.shadowRoot?.innerHTML || ''")
                assert "Reader security fixture" in content, content[:800]
                assert "<script" not in content.lower(), "Script survived EPUB sanitization"
                assert "onerror" not in content.lower(), "Event handler survived sanitization"
                assert "javascript:" not in content.lower(), "Unsafe link survived sanitization"
                # Generated blob: URLs must survive sanitization and load
                # without permitting script/event handlers from the EPUB.
                page.wait_for_timeout(700)
                images = host.evaluate("""(el) =>
                  ['test-cover', 'test-illustration'].map(id => {
                    const image = el.shadowRoot.querySelector('#' + id);
                    return {id, src: image?.getAttribute('src'),
                            loaded: !!image?.complete && image.naturalWidth > 0,
                            complete: image?.complete,
                            naturalWidth: image?.naturalWidth,
                            naturalHeight: image?.naturalHeight,
                            currentSrc: image?.currentSrc};
                  })""")
                if not all(image['src'] and image['src'].startswith('blob:')
                           and image['loaded'] for image in images):
                    blobs = host.evaluate("""async (el) => {
                      const list = [];
                      for (const id of ['test-cover', 'test-illustration']) {
                        const url = el.shadowRoot.querySelector('#' + id)?.getAttribute('src');
                        const blob = window.__epubAssetBlobs?.get(url);
                        const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
                        list.push({id, blobRecorded: !!blob,
                          mime: blob?.type, size: blob?.size,
                          firstBytes: bytes ? Array.from(bytes.slice(0, 20)) : null,
                          revoked: window.__epubAssetRevoked?.includes(url),
                          trackedBlobCount: window.__epubAssetBlobs?.size});
                      }
                      return list;
                    }""")
                    raise AssertionError((images, image_diagnostics, blobs))
                assert page.evaluate("window.__epubespiar_xss") is None, "EPUB executed script"
                assert not errors, f"Reader JS errors: {errors}"
                print("PASS: extension renders cover and chapter images; unsafe XHTML removed")
            finally:
                context.close()


if __name__ == "__main__":
    main()
