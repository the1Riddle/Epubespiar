/**
 * Wait for actual download data, not merely a click or a returned browser ID.
 * downloads.onChanged does not report bytesReceived, so poll downloads.search.
 * Stops after ~90s; a pending browser download is not cancelled on timeout.
 */
export async function waitForDownloadActivity(downloadId, {
  getItem,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  intervalMs = 750,
  maxChecks = 120,
} = {}) {
  if (!Number.isInteger(downloadId) || downloadId < 0) {
    throw new Error("Invalid browser download ID");
  }
  if (typeof getItem !== "function") {
    throw new Error("Missing browser download status API");
  }

  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const item = await getItem(downloadId);
    if (item?.state === "interrupted") {
      throw new Error(`Download interrupted: ${item.error || "network or file error"}`);
    }
    if (item?.state === "complete" || (item?.bytesReceived ?? 0) > 0) {
      return { status: "started", downloadId };
    }
    if (attempt < maxChecks - 1) await pause(intervalMs);
  }

  // The browser still owns the request. Do not cancel, invent a failure,
  // or claim that bytes were received.
  return { status: "waiting", downloadId };
}
