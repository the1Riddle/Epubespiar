import useBookStorage from "../../composables/useBookStorage.js";
import useCollections from "../../composables/useCollections.js";

const positionKey = "readerReadingPositions";
const localKey = "local_" + positionKey;
const books = useBookStorage();

function legacyPositionKey(metadata) {
  const identifier = String(metadata?.identifier || "").trim();
  if (identifier) return `id:${identifier}`;
  const title = String(metadata?.title || "untitled").trim().toLowerCase();
  const creator = String(metadata?.creator || "unknown").trim().toLowerCase();
  return `meta:${title}::${creator}`;
}

async function readPositions() {
  const storage = globalThis.chrome?.storage?.local;
  if (storage) return (await storage.get(positionKey))[positionKey] || {};
  return JSON.parse(localStorage.getItem(localKey) || "{}");
}

async function writePositions(positions) {
  const storage = globalThis.chrome?.storage?.local;
  if (Object.keys(positions).length) {
    if (storage) await storage.set({ [positionKey]: positions });
    else localStorage.setItem(localKey, JSON.stringify(positions));
  } else if (storage) await storage.remove(positionKey);
  else localStorage.removeItem(localKey);
}

export async function getPosition(bookId, metadata) {
  const positions = await readPositions();
  return positions[bookId] ?? positions[legacyPositionKey(metadata)];
}

export function savePosition(bookId, position) {
  // Serialize updates across reader tabs because all positions share one storage key.
  return navigator.locks.request(positionKey, async () => {
    if (!await books.hasBook(bookId)) return;
    const positions = await readPositions();
    positions[bookId] = position;
    await writePositions(positions);
  });
}

export function removeLibraryBook(book) {
  return navigator.locks.request(positionKey, async () => {
    const positions = await readPositions();
    const legacy = legacyPositionKey(book.metadata);
    if (legacy in positions) {
      const others = await books.getAllBooks();
      if (!others.some(other => other.id !== book.id && legacyPositionKey(other.metadata) === legacy)) {
        delete positions[legacy];
      }
    }
    delete positions[book.id];
    await writePositions(positions);
    useCollections().removeBookFromAllCollections(book.id);
    // Delete the visible record last so a failed cleanup can be retried.
    await books.deleteBook(book.id);
  });
}
