"""Exercise the production chapter renderer inside Firefox's native DOM."""
import base64
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    source = Path(__file__).resolve().parents[1] / "src/services/epubProcesor/renderChapter.js"
    module_url = "data:text/javascript;base64," + base64.b64encode(source.read_bytes()).decode()
    with sync_playwright() as playwright, playwright.firefox.launch() as browser:
        page = browser.new_page()
        result = page.evaluate("""async url => {
          const { renderChapter } = await import(url);
          const asset = URL.createObjectURL(new Blob(['image']));
          try {
            const chapter = renderChapter(
              '<h2 id="entry" class="title" lang="sw">Sura</h2><a href="#entry">Rudi</a>' +
              '<svg><image href="' + asset + '"/></svg><img src="blob:unregistered">',
              value => value === asset
            );
            document.body.append(chapter);
            return [
              chapter.querySelector('h2.title#entry[lang="sw"]')?.textContent,
              chapter.querySelector('a')?.getAttribute('href'),
              chapter.querySelector('svg image')?.getAttribute('href') === asset,
              chapter.querySelector('img')?.hasAttribute('src')
            ];
          } finally { URL.revokeObjectURL(asset); }
        }""", module_url)
        assert result == ["Sura", "#entry", True, False], result
        print("PASS: Firefox chapter text, anchors, and SVG image ownership")


if __name__ == "__main__":
    main()
