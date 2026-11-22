import test from "node:test";
import assert from "node:assert/strict";
import { waitForDownloadActivity } from "../src/services/epubProcesor/downloadActivity.js";
import { fetchWithRetry } from "../src/services/epubHttps/fetchWithRetry.js";
import { readLimitedBlob } from "../src/services/epubHttps/limitedResponse.js";

test("browser download indicator waits for received bytes, not just the download ID", async () => {
  let checks = 0;
  let pauses = 0;
  const result = await waitForDownloadActivity(5, {
    getItem: async () => ({
      state: "in_progress",
      bytesReceived: ++checks >= 3 ? 100 : 0,
    }),
    pause: async () => { pauses++; },
    maxChecks: 5,
  });
  assert.deepEqual(result, {status: "started", downloadId: 5});
  assert.equal(checks, 3);
  assert.equal(pauses, 2);
});

test("browser download reports interruption and does not claim success", async () => {
  await assert.rejects(
    waitForDownloadActivity(3, {
      getItem: async () => ({state: "interrupted", error: "NETWORK_FAILED"}),
      pause: async () => {},
    }),
    /NETWORK_FAILED/,
  );
});

test("slow download remains owned by browser after the observation window", async () => {
  const result = await waitForDownloadActivity(9, {
    getItem: async () => ({state: "in_progress", bytesReceived: 0}),
    pause: async () => {},
    maxChecks: 3,
  });
  assert.deepEqual(result, {status: "waiting", downloadId: 9});
});

test("transient body-stream errors are retried before returning EPUB bytes", async () => {
  let calls = 0;
  let reads = 0;
  const bytes = await fetchWithRetry("https://example.test/book.epub", 2, {
    fetcher: async () => { calls++; return new Response("epub"); },
    readResponse: async (response) => {
      reads++;
      if (reads === 1) throw new TypeError("network read interrupted");
      return readLimitedBlob(response, 1000);
    },
    pause: async () => {},
  });
  assert.equal(await bytes.text(), "epub");
  assert.equal(calls, 2);
});

test("permission failures and size-limit failures are never retried", async () => {
  let calls = 0;
  await assert.rejects(fetchWithRetry("https://example.test/book", 2, {
    fetcher: async () => {
      calls++;
      return new Response("Forbidden", {status: 403});
    },
    pause: async () => {},
  }), /403/);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(fetchWithRetry("https://example.test/book", 2, {
    fetcher: async () => {
      calls++;
      return new Response("oversized-data");
    },
    readResponse: response => readLimitedBlob(response, 3),
    pause: async () => {},
  }), /size limit/);
  assert.equal(calls, 1);
});
