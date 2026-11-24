"""Round-trip an EPUB in installed Firefox and in the Vite reader UI."""
import json
import shutil
import ssl
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support import expected_conditions as conditions
from selenium.webdriver.support.ui import WebDriverWait

from browser_smoke import write_epub


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        source = root / "input.epub"
        write_epub(source)
        original = source.read_bytes()
        requests = []

        class Source(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path != "/example.php":
                    self.send_error(404)
                    return
                requests.append(self.path)
                if len(requests) > 1:
                    self.send_error(410)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/epub+zip")
                self.send_header("Content-Length", str(len(original)))
                self.end_headers()
                self.wfile.write(original)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Source)
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                        "-subj", "/CN=localhost", "-days", "1", "-keyout", str(root / "key"),
                        "-out", str(root / "cert")], stderr=subprocess.DEVNULL, check=True)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(root / "cert", root / "key")
        server.socket = tls.wrap_socket(server.socket, server_side=True)
        threading.Thread(target=server.serve_forever, daemon=True).start()

        package = Path("dist/firefox")
        addon_id = json.loads((package / "manifest.json").read_text())["browser_specific_settings"]["gecko"]["id"]
        uuid = "deadbeef-307e-403b-9c8a-f7fa96e40e20"
        archive = shutil.make_archive(str(root / "reader"), "zip", package)
        options = webdriver.FirefoxOptions()
        options.add_argument("-headless")
        options.accept_insecure_certs = True
        options.set_preference("extensions.webextensions.uuids", json.dumps({addon_id: uuid}))
        options.set_preference("browser.download.folderList", 2)
        options.set_preference("browser.download.dir", str(root))
        options.set_preference("browser.download.useDownloadDir", True)
        options.set_preference("browser.helperApps.neverAsk.saveToDisk", "application/epub+zip")
        output = root / "Security fixture.epub"
        # WebDriver requires explicit test-session access to extension pages.
        service = Service(service_args=["--allow-system-access"])
        with server, webdriver.Firefox(options=options, service=service) as driver:
            wait = WebDriverWait(driver, 30)
            driver.install_addon(archive, temporary=True)
            url = f"https://localhost:{server.server_port}/example.php"
            driver.get(f"moz-extension://{uuid}/reader.html?file={quote(url, safe='')}")
            save = (By.CSS_SELECTOR, ".download-book-button")

            def verify_save():
                try:
                    wait.until(conditions.element_to_be_clickable(save)).click()
                except Exception:
                    print("Reader state:", driver.current_url, driver.find_element(By.TAG_NAME, "body").text[:1500])
                    raise
                wait.until(lambda _: output.exists() and output.read_bytes() == original)
                output.unlink()

            verify_save()
            assert len(requests) == 1, requests
            driver.get("http://localhost:8080/")
            wait.until(conditions.presence_of_element_located((By.CSS_SELECTOR, "input[type=file]"))).send_keys(str(source))
            verify_save()
            print("PASS: one-use Firefox extension download and localhost reader export")


if __name__ == "__main__":
    main()
