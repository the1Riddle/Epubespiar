/**
 * Preflight resource budgets before inflating untrusted EPUB ZIP entries.
 * JSZip 3.x exposes sizes on _data; fail closed if that metadata disappears.
 */
export const ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 2500,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

export function assertArchiveWithinLimits(zip) {
  const entries = Object.values(zip.files || {}).filter((entry) => !entry.dir);
  if (entries.length > ARCHIVE_LIMITS.maxEntries) {
    throw new Error("EPUB archive contains too many files");
  }

  let total = 0;
  for (const entry of entries) {
    const size = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("EPUB archive has unsupported size metadata");
    }
    if (size > ARCHIVE_LIMITS.maxEntryBytes) {
      throw new Error("EPUB archive contains an oversized entry");
    }
    total += size;
    if (total > ARCHIVE_LIMITS.maxTotalBytes) {
      throw new Error("EPUB archive expands beyond the safety limit");
    }
  }
}
