/**
 * Firefox does not currently allow moz-extension pages to fetch file:// resources.
 * The regular file picker and reader-page drag/drop remain supported there.
 */
export function canLoadLocalFileFromReader(extensionPageUrl) {
  try {
    return new URL(extensionPageUrl).protocol !== "moz-extension:";
  } catch {
    return false;
  }
}

/**
 * Permit a manual browser download only from our reader page, and only for
 * the exact HTTPS URL the reader was opened with. Opaque /download/<id> URLs
 * are valid EPUB sources even when the path has no .epub extension.
 * Content scripts on unrelated websites cannot invoke this capability.
 */
export function isAuthorizedReaderDownload({ sender, url, extensionId, readerUrl }) {
  if (!url || typeof url !== "string" || sender?.id !== extensionId) return false;
  try {
    const target = new URL(url);
    const source = new URL(sender.url || "");
    const reader = new URL(readerUrl);
    return target.protocol === "https:" && target.pathname.length < 2048 &&
      source.protocol === reader.protocol && source.host === reader.host &&
      source.pathname === reader.pathname &&
      source.searchParams.get("file") === url;
  } catch {
    return false;
  }
}
