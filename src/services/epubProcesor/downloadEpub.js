import browser from "webextension-polyfill";
import { waitForDownloadActivity } from "./downloadActivity.js";

/**
 * Hand the original HTTPS URL to the browser download manager. Unlike fetch
 * + blob + <a>, the native API preserves cookies, server filenames, and exposes
 * an ID we can query for real transfer activity or network interruption.
 */
export async function downloadEpub(url) {
  if (new URL(url).protocol !== "https:") {
    throw new Error("Only HTTPS EPUB sources can be downloaded");
  }

  const response = await browser.runtime.sendMessage({
    type: "ALLOW_DOWNLOAD",
    url,
  });
  if (!response?.success || !Number.isInteger(response.downloadId)) {
    throw new Error(response?.error || "Browser did not accept the download");
  }

  return waitForDownloadActivity(response.downloadId, {
    getItem: async (id) => {
      const [item] = await browser.downloads.search({ id });
      return item;
    },
  });
}
