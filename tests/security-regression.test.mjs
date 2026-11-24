import test from "node:test";
import JSZip from "jszip";

import assert from "node:assert/strict";
import { assertArchiveWithinLimits, ARCHIVE_LIMITS } from "../src/services/epubProcesor/archiveLimits.js";
import { canLoadLocalFileFromReader } from "../src/background/downloadPolicy.js";
import { validateFile } from "../src/utils/security.js";
import { readLimitedBlob } from "../src/services/epubHttps/limitedResponse.js";
import { resolveArchivePath } from "../src/services/epubProcesor/pathUtils.js";

const makeZip = async (files = { "mimetype": "application/epub+zip" }) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
};

const editCentralDirectory = (bytes, edit) => {
  const changed = bytes.slice();
  const view = new DataView(changed.buffer);
  const centralRecords = [];
  let eocd = -1;
  for (let i = changed.length - 22; i >= Math.max(0, changed.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 &&
        i + 22 + view.getUint16(i + 20, true) === changed.length) {
      eocd = i; break;
    }
  }
  if (eocd === -1) throw new Error("Bad test ZIP");
  let ptr = view.getUint32(eocd + 16, true);
  const count = view.getUint16(eocd + 10, true);
  for (let i = 0; i < count; i++) {
    centralRecords.push(ptr);
    ptr += 46 + view.getUint16(ptr + 28, true) +
      view.getUint16(ptr + 30, true) + view.getUint16(ptr + 32, true);
  }
  edit(view, centralRecords, eocd);
  return changed;
};

test("ZIP central directory preflight accepts a real JSZip EPUB and ignores JSZip internals", async () => {
  const bytes = await makeZip();
  assert.doesNotThrow(() => assertArchiveWithinLimits(bytes));
  assert.doesNotThrow(() => assertArchiveWithinLimits(bytes.buffer));
});

test("ZIP central directory rejects per-entry and total expanded byte limits", async () => {
  const one = await makeZip();
  const oversized = editCentralDirectory(one, (view, records) => {
    view.setUint32(records[0] + 24, ARCHIVE_LIMITS.maxEntryBytes + 1, true);
  });
  assert.throws(() => assertArchiveWithinLimits(oversized), /oversized/);

  const five = await makeZip({ a: "a", b: "b", c: "c", d: "d", e: "e" });
  const inflated = editCentralDirectory(five, (view, records) => {
    records.forEach(ptr => view.setUint32(ptr + 24, ARCHIVE_LIMITS.maxEntryBytes, true));
  });
  assert.throws(() => assertArchiveWithinLimits(inflated), /safety limit/);
});

test("ZIP central directory rejects excessive entries, corruption and unsupported ZIP64", async () => {
  const bytes = await makeZip();
  const tooMany = editCentralDirectory(bytes, (view, _, eocd) => {
    view.setUint16(eocd + 8, ARCHIVE_LIMITS.maxEntries + 1, true);
    view.setUint16(eocd + 10, ARCHIVE_LIMITS.maxEntries + 1, true);
  });
  assert.throws(() => assertArchiveWithinLimits(tooMany), /too many/);
  const zip64 = editCentralDirectory(bytes, (view, _, eocd) => {
    view.setUint32(eocd + 16, 0xffffffff, true);
  });
  assert.throws(() => assertArchiveWithinLimits(zip64), /ZIP64/);
  assert.throws(() => assertArchiveWithinLimits(new Uint8Array(10)), /ZIP central directory/);
});

test("local interception requires Chromium and confirmed file access", async () => {
  const chromium = "chrome-extension://abc/reader.html";
  const granted = { isAllowedFileSchemeAccess: async () => true };
  assert.equal(await canLoadLocalFileFromReader(chromium, granted), true);
  assert.equal(await canLoadLocalFileFromReader("moz-extension://abc/reader.html", granted), false);
  assert.equal(await canLoadLocalFileFromReader(chromium), false);
  assert.equal(await canLoadLocalFileFromReader(chromium, {
    isAllowedFileSchemeAccess: async () => false,
  }), false);
  assert.equal(await canLoadLocalFileFromReader(chromium, {
    isAllowedFileSchemeAccess: async () => { throw new Error("Unavailable"); },
  }), false);
});
test("EPUB files with missing MIME type are accepted but other extensions are not", () => {
  assert.equal(validateFile({name: "book.epub", type: "", size: 120}, 1_000, ["application/epub+zip"]), true);
  assert.equal(validateFile({name: "book.epub", type: "application/octet-stream", size: 120}, 1_000, ["application/epub+zip"]), true);
  assert.equal(validateFile({name: "book.html", type: "", size: 120}, 1_000, ["application/epub+zip"]), false);
  assert.equal(validateFile({name: "book.epub", type: "", size: 2_000}, 1_000, ["application/epub+zip"]), false);
});
test("remote response rejects declared oversized payload", async () => {
  const response = new Response("data", {headers: {"content-length": "999999"}});
  await assert.rejects(readLimitedBlob(response, 100), /size limit/);
});
test("remote response rejects streamed oversized payload", async () => {
  const response = new Response("a".repeat(101));
  await assert.rejects(readLimitedBlob(response, 100), /size limit/);
});
test("remote response accepts small payload", async () => {
  const blob = await readLimitedBlob(new Response("epub"), 100);
  assert.equal(await blob.text(), "epub");
});

test("EPUB archive assets support encoded filenames, fragments and query parameters", () => {
  const files = {
    "EPUB/images/cover image.png": {},
    "EPUB/images/literal%20name.png": {},
    "EPUB/styles/book.css": {}
  };
  assert.equal(resolveArchivePath("EPUB", "images/cover%20image.png#page=1", files), "EPUB/images/cover image.png");
  assert.equal(resolveArchivePath("EPUB", "images/literal%20name.png", files), "EPUB/images/literal%20name.png");
  assert.equal(resolveArchivePath("EPUB/chapters", "../styles/book.css?v=1", files), "EPUB/styles/book.css");
  assert.equal(resolveArchivePath("EPUB", "images/cover%2Fimage.png", files), "");
  assert.equal(resolveArchivePath("EPUB", "https://evil.example/a.png", files), "");
  assert.equal(resolveArchivePath("EPUB", "javascript:alert(1)", files), "");
});
