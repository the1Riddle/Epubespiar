"""Chromium extension smoke tests using the built unpacked MV3 extension.

Runs on GitHub Actions with Playwright's extension-capable Chromium build.
Never includes a malicious fixture outside the local throwaway browser profile.
"""
from pathlib import Path
import os
import tempfile
import zipfile
from playwright.sync_api import sync_playwright

DIST = (Path(__file__).resolve().parents[1] / "dist" / "chrome").resolve()


def write_epub(path: Path, malicious: bool = False):
    chapter = """<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Safe Chapter</title></head>
  <body><h1>Reader security fixture</h1><p>Hello, Epubespiar.</p>
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
                page.wait_for_timeout(700)
                assert page.evaluate("window.__epubespiar_xss") is None, "EPUB executed script"
                assert not errors, f"Reader JS errors: {errors}"
                print("PASS: extension starts, EPUB loads, unsafe XHTML removed")
            finally:
                context.close()


if __name__ == "__main__":
    main()
