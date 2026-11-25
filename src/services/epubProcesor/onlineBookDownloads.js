import useCollections from "../../composables/useCollections.js";

const prefix = "epub_pending_download:";
const keyFor = id => prefix + id;

export function trackOnlineBookDownload(id, bookId, collectionId) {
  localStorage.setItem(keyFor(id), JSON.stringify({ bookId, collectionId }));
}

export function settleOnlineBookDownload(id, state) {
  if (state === "in_progress") return;
  const key = keyFor(id);
  const pending = localStorage.getItem(key);
  if (!pending) return;
  if (state === "complete") {
    const { bookId, collectionId } = JSON.parse(pending);
    useCollections().removeBookFromCollection(collectionId, bookId);
  }
  localStorage.removeItem(key);
}

export function observeOnlineBookDownloads(downloads) {
  if (!downloads) return () => {};
  const changed = delta => {
    if (delta.state) settleOnlineBookDownload(delta.id, delta.state.current);
  };
  const erased = id => settleOnlineBookDownload(id, "erased");
  downloads.onChanged.addListener(changed);
  downloads.onErased.addListener(erased);

  // Reconcile downloads that finished while every reader tab was closed.
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(prefix)) continue;
    const id = Number(key.slice(prefix.length));
    downloads.search({ id }).then(([item]) => {
      settleOnlineBookDownload(id, item?.state ?? "erased");
    }).catch(error => console.warn("Could not check EPUB download", error));
  }
  return () => {
    downloads.onChanged.removeListener(changed);
    downloads.onErased.removeListener(erased);
  };
}
