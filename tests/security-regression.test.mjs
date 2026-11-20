import test from "node:test";
import assert from "node:assert/strict";
import { assertArchiveWithinLimits, ARCHIVE_LIMITS } from "../src/services/epubProcesor/archiveLimits.js";
import { canLoadLocalFileFromReader } from "../src/background/downloadPolicy.js";
import { validateFile } from "../src/utils/security.js";
import { readLimitedBlob } from "../src/services/epubHttps/limitedResponse.js";
import { resolveArchivePath } from "../src/services/epubProcesor/pathUtils.js";

const fakeZip = (sizes) => ({
  files: Object.fromEntries(sizes.map((size, i) =>
    [String(i), { dir: false, _data: { uncompressedSize: size } }])),
});

test("archive limits permit bounded content", () => {
  assert.doesNotThrow(() => assertArchiveWithinLimits(fakeZip([0, 1024])));
});
test("archive limits reject excessive expanded bytes", () => {
  assert.throws(() => assertArchiveWithinLimits(fakeZip([ARCHIVE_LIMITS.maxEntryBytes + 1])), /oversized/);
  assert.throws(() => assertArchiveWithinLimits(fakeZip(Array(5).fill(ARCHIVE_LIMITS.maxEntryBytes))), /safety limit/);
});
test("archive limits reject excessive entries or missing size metadata", () => {
  assert.throws(() => assertArchiveWithinLimits(fakeZip(Array(ARCHIVE_LIMITS.maxEntries + 1).fill(1))), /too many/);
  assert.throws(() => assertArchiveWithinLimits({files: {a: {dir: false, _data: {}}}}), /unsupported/);
});
test("file URL handling respects Firefox principal restriction", () => {
  assert.equal(canLoadLocalFileFromReader("moz-extension://abc/reader.html"), false);
  assert.equal(canLoadLocalFileFromReader("chrome-extension://abc/reader.html"), true);
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
