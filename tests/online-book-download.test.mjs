import test from "node:test";
import assert from "node:assert/strict";
import { COLLECTIONS_KEY } from "../src/composables/useCollections.js";
import {
  observeOnlineBookDownloads, settleOnlineBookDownload, trackOnlineBookDownload
} from "../src/services/epubProcesor/onlineBookDownloads.js";

test("only a confirmed completed export removes its captured collection membership", async t => {
  class Storage {
    getItem(key) { return this[key] ?? null; }
    setItem(key, value) { this[key] = value; }
    removeItem(key) { delete this[key]; }
  }
  const storage = new Storage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  globalThis.window = new EventTarget();
  t.after(() => { delete globalThis.localStorage; delete globalThis.window; });
  const collections = [
    { id: "online", bookIds: ["book", "other"] },
    { id: "favorites", bookIds: ["book"] }
  ];
  storage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
  for (const state of ["interrupted", "erased"]) {
    trackOnlineBookDownload(10, "book", "online");
    settleOnlineBookDownload(10, state);
    assert.deepEqual(JSON.parse(storage.getItem(COLLECTIONS_KEY)), collections);
  }
  trackOnlineBookDownload(11, "book", "online");
  settleOnlineBookDownload(11, "in_progress");
  settleOnlineBookDownload(12, "complete");
  assert.deepEqual(JSON.parse(storage.getItem(COLLECTIONS_KEY)), collections);

  // The original reader went away; the new reader can consult browser history.
  const event = { addListener() {}, removeListener() {} };
  const stop = observeOnlineBookDownloads({
    onChanged: event, onErased: event,
    search: async ({ id }) => { assert.equal(id, 11); return [{ state: "complete" }]; }
  });
  await new Promise(resolve => setImmediate(resolve));
  stop();
  assert.deepEqual(JSON.parse(storage.getItem(COLLECTIONS_KEY)), [
    { id: "online", bookIds: ["other"] }, collections[1]
  ]);
  assert.deepEqual(Object.keys(storage), [COLLECTIONS_KEY]);
});
