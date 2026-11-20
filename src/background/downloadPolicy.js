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
