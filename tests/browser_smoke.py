"""Chromium extension smoke tests using the built unpacked MV3 extension.

Runs on GitHub Actions with Playwright's extension-capable Chromium build.
Never includes a malicious fixture outside the local throwaway browser profile.
"""
from pathlib import Path
import hashlib
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

    signature = b"\x89PNG\r\n\x1a\n"
    header = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    pixels = zlib.compress(b"\x00\xff\x50\x20")
    return (signature + chunk(b"IHDR", header) + chunk(b"IDAT", pixels)
            + chunk(b"IEND", b""))


def write_epub(path: Path, malicious: bool = False):
    chapter = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Safe Chapter</title><style media="print">.author { color: purple }</style></head>
  <body><h1>Reader security fixture</h1><p>Hello, Epubespiar.</p>
  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image id="svg-cover" href="cover.png" width="10" height="10"/></svg>
  <img id="test-cover" src="cover.png" alt="cover"/>
  <img id="test-illustration" src="images/illustration.png" alt="illustration"/>
  <img id="encoded-cover" src="images/cover%20with%20spaces.png#image" alt="encoded cover"/>
  <img id="untrusted-blob" src="blob:https://untrusted.example.invalid/1234"/>
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
  <item id="cover" href="images/cover%20with%20spaces.png" media-type="image/png" properties="cover-image"/>
</manifest>
<spine><itemref idref="one"/></spine>
</package>""",
        )
        archive.writestr("EPUB/chapter.xhtml", chapter)
        archive.writestr("EPUB/cover.png", fixture_png())
        archive.writestr("EPUB/images/illustration.png", fixture_png())
        archive.writestr("EPUB/images/cover with spaces.png", fixture_png())


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
                errors = []
                page.on("pageerror", lambda exc: errors.append(str(exc)))
                page.goto(f"chrome-extension://{extension_id}/reader.html")
                page.locator(".epub-reader").evaluate("""(reader, bytes) => {
                  const dataTransfer = new DataTransfer();
                  dataTransfer.items.add(new File([new Uint8Array(bytes)], 'local.epub',
                    {type: 'application/epub+zip'}));
                  reader.dispatchEvent(new DragEvent('drop', {bubbles: true, dataTransfer}));
                }""", list(book.read_bytes()))
                host = page.locator(".chapter-content-host").first
                host.wait_for(state="visible", timeout=25000)
                assert page.locator(".download-book-button").count() == 0, "Local drop offered a download"
                content = host.evaluate("(el) => el.shadowRoot?.innerHTML || ''")
                assert "Reader security fixture" in content, content[:800]
                assert "<script" not in content.lower(), "Script survived EPUB sanitization"
                assert "onerror" not in content.lower(), "Event handler survived sanitization"
                assert "javascript:" not in content.lower(), "Unsafe link survived sanitization"
                # Generated blob: URLs must survive sanitization and load
                # without permitting script/event handlers from the EPUB.
                page.wait_for_timeout(700)
                images = host.evaluate("""(el) =>
                  ['test-cover', 'test-illustration', 'encoded-cover'].map(id => {
                    const image = el.shadowRoot.querySelector('#' + id);
                    return {id, src: image?.getAttribute('src'),
                            loaded: !!image?.complete && image.naturalWidth > 0,
                            complete: image?.complete,
                            naturalWidth: image?.naturalWidth,
                            naturalHeight: image?.naturalHeight,
                            currentSrc: image?.currentSrc};
                  })""")
                assert all(image['src'] and image['src'].startswith('blob:')
                           and image['loaded'] for image in images), images
                untrusted = host.evaluate("""(el) =>
                  el.shadowRoot.querySelector('#untrusted-blob')?.getAttribute('src')
                """)
                assert not untrusted, "Arbitrary EPUB-supplied blob URL survived sanitizer"
                assert host.evaluate("""el => {
                  const root = el.shadowRoot;
                  return root.querySelector('style[media="print"]')?.textContent.includes('.author')
                    && root.querySelector('svg image')?.getAttribute('href')?.startsWith('blob:');
                }"""), "Chapter lost print CSS or an archive-backed SVG illustration"
                saved_cover = page.evaluate("""async () => {
                  const db = await new Promise((resolve, reject) => {
                    const request = indexedDB.open('EpubReaderDB');
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                  });
                  try {
                    return await new Promise((resolve, reject) => {
                      const tx = db.transaction('books', 'readonly');
                      const request = tx.objectStore('books').getAll();
                      request.onsuccess = () => resolve(request.result[0]?.cover || '');
                      request.onerror = () => reject(request.error);
                    });
                  } finally {
                    db.close();
                  }
                }""")
                assert saved_cover.startswith('data:image/png;base64,'), (
                    'Encoded OPF cover image not saved in bookshelf'
                )
                assert page.evaluate("window.__epubespiar_xss") is None, "EPUB executed script"
                assert not errors, f"Reader JS errors: {errors}"

                # Panel commands must be reversible, with Escape reserved for
                # fullscreen. Focus the page rather than the EPUB file picker.
                page.evaluate("document.activeElement?.blur()")
                page.keyboard.press("Control+Home")
                page.locator(".bookshelf-container").wait_for(state="visible", timeout=5000)
                page.keyboard.press("Escape")
                assert page.locator(".bookshelf-container").is_visible(), (
                    "Escape unexpectedly closed the library"
                )
                page.keyboard.press("Control+Home")
                page.locator(".bookshelf-container").wait_for(state="hidden", timeout=5000)

                page.keyboard.press("Control+[")
                page.locator(".sidebar.open").wait_for(state="visible", timeout=5000)
                page.keyboard.press("Escape")
                assert page.locator(".sidebar.open").is_visible(), (
                    "Escape unexpectedly closed the table of contents"
                )
                # Both TOC shortcuts operate on the same toggle state.
                page.keyboard.press("Control+]")
                page.locator(".sidebar.open").wait_for(state="hidden", timeout=5000)
                page.keyboard.press("Control+]")
                page.locator(".sidebar.open").wait_for(state="visible", timeout=5000)
                page.keyboard.press("Control+]")
                page.locator(".sidebar.open").wait_for(state="hidden", timeout=5000)

                page.keyboard.press("Control+F9")
                settings = page.locator("dialog.reader-settings[open]")
                settings.wait_for(state="visible", timeout=5000)
                page.keyboard.press("Escape")
                assert settings.is_visible(), "Escape unexpectedly dismissed settings"
                # Settings blocks bubble-phase events; the keyboard toggle
                # must close it even when focus is inside a settings control.
                # Checkboxes are conditional on the selected tab, while tabs
                # always exist and are keyboard focusable.
                settings.locator('[role="tab"]').first.focus()
                page.keyboard.press("Control+F9")
                settings.wait_for(state="hidden", timeout=5000)

                # Esc should leave fullscreen without closing the TOC.
                page.keyboard.press("Control+[")
                page.locator(".sidebar.open").wait_for(state="visible", timeout=5000)
                fullscreen_button = page.locator('button[title="Enter full Screen"]')
                fullscreen_button.click()
                page.wait_for_function("!!document.fullscreenElement", timeout=5000)
                page.keyboard.press("Escape")
                page.wait_for_function("!document.fullscreenElement", timeout=5000)
                assert page.locator(".sidebar.open").is_visible(), (
                    "Escape exited fullscreen but unexpectedly closed the TOC"
                )
                page.keyboard.press("Control+[")
                page.locator(".sidebar.open").wait_for(state="hidden", timeout=5000)

                # Seed a legacy bookmark and a collection updated outside the sidebar.
                book_id = "sha256:" + hashlib.sha256(book.read_bytes()).hexdigest()
                await_setup = """async id => {
                  await chrome.storage.local.set({readerReadingPositions: {
                    [id]: {scrollPercentage: 25},
                    'id:epubespiar-security-fixture': {scrollPercentage: 20},
                    other: {scrollPercentage: 13}
                  }});
                  localStorage.setItem('epub_reader_collections', JSON.stringify([
                    {id: 'all', name: 'All Books', bookIds: [], isDefault: true},
                    {id: 'custom', name: 'Shelf', bookIds: [id, 'other']}
                  ]));
                }"""
                page.keyboard.press("Control+Home")
                page.locator(".book-card").first.hover()
                page.evaluate(await_setup, book_id)
                page.get_by_title("Remove from library").click()
                page.locator(".dialog-button.danger").click()
                host.wait_for(state="detached")
                page.locator(".book-card").first.wait_for(state="detached")
                remaining = page.evaluate("""async () => {
                  const db = await new Promise(resolve => {
                    const req = indexedDB.open('EpubReaderDB');
                    req.onsuccess = () => resolve(req.result);
                  });
                  const ids = await new Promise(resolve => {
                    const req = db.transaction('books').objectStore('books').getAllKeys();
                    req.onsuccess = () => resolve(req.result);
                  });
                  db.close();
                  return [ids, (await chrome.storage.local.get('readerReadingPositions')).readerReadingPositions,
                    JSON.parse(localStorage.getItem('epub_reader_collections'))[1].bookIds];
                }""")
                assert remaining == [[], {"other": {"scrollPercentage": 13}}, ["other"]], remaining

                assert not errors, f"Reader JS errors after shortcuts: {errors}"
                print("PASS: cover/images, unsafe XHTML blocked, panel toggles and Escape fullscreen")

            finally:
                context.close()


if __name__ == "__main__":
    main()
