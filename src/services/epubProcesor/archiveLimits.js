/** ZIP central-directory preflight: does not depend on private JSZip internals. */
export const ARCHIVE_LIMITS = Object.freeze({
  maxEntries: 2500,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

/**
 * Reject archives whose declared expanded size exceeds our resource budget.
 * Inspect the ZIP central directory directly, before asking JSZip to parse it.
 * ZIP64 and multi-disk archives are deliberately unsupported (EPUB max 100 MB).
 * This avoids false negatives from JSZip's undocumented _data property.
 */
export function assertArchiveWithinLimits(bytes) {
  const view = bytes instanceof ArrayBuffer
    ? new DataView(bytes)
    : ArrayBuffer.isView(bytes)
      ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : null;
  if (!view || view.byteLength < 22) {
    throw new Error("Invalid EPUB: missing ZIP central directory");
  }

  const u16 = (offset) => view.getUint16(offset, true);
  const u32 = (offset) => view.getUint32(offset, true);
  const lastPossibleEocd = view.byteLength - 22;
  const earliestEocd = Math.max(0, lastPossibleEocd - MAX_ZIP_COMMENT_BYTES);
  let eocd = -1;
  for (let pos = lastPossibleEocd; pos >= earliestEocd; pos -= 1) {
    if (u32(pos) === EOCD_SIGNATURE &&
        pos + 22 + u16(pos + 20) === view.byteLength) {
      eocd = pos;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid EPUB: missing ZIP central directory");

  const disk = u16(eocd + 4);
  const directoryDisk = u16(eocd + 6);
  const entriesOnDisk = u16(eocd + 8);
  const entryCount = u16(eocd + 10);
  const directoryBytes = u32(eocd + 12);
  const directoryOffset = u32(eocd + 16);
  if (disk !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount ||
      entryCount === 0xffff || directoryBytes === 0xffffffff ||
      directoryOffset === 0xffffffff) {
    throw new Error("Unsupported EPUB ZIP: multi-volume or ZIP64 directory");
  }
  if (entryCount > ARCHIVE_LIMITS.maxEntries) {
    throw new Error("EPUB archive contains too many files");
  }

  const end = directoryOffset + directoryBytes;
  if (end > eocd || end > view.byteLength) {
    throw new Error("Invalid EPUB: ZIP directory outside archive");
  }

  let cursor = directoryOffset;
  let total = 0;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > end || u32(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error("Invalid EPUB: malformed ZIP directory entry");
    }
    const flags = u16(cursor + 8);
    const size = u32(cursor + 24);
    const filenameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const entryDisk = u16(cursor + 34);
    const localOffset = u32(cursor + 42);
    if ((flags & 1) !== 0 || (flags & 0x40) !== 0) {
      throw new Error("Unsupported EPUB ZIP: encrypted entry");
    }
    if (size === 0xffffffff || localOffset === 0xffffffff || entryDisk !== 0) {
      throw new Error("Unsupported EPUB ZIP: ZIP64 entry");
    }

    cursor += 46 + filenameLength + extraLength + commentLength;
    if (cursor > end) throw new Error("Invalid EPUB: truncated ZIP directory");
    if (size > ARCHIVE_LIMITS.maxEntryBytes) {
      throw new Error("EPUB archive contains an oversized entry");
    }
    total += size;
    if (total > ARCHIVE_LIMITS.maxTotalBytes) {
      throw new Error("EPUB archive expands beyond the safety limit");
    }
  }
  if (cursor !== end) throw new Error("Invalid EPUB: inconsistent ZIP directory size");
}
