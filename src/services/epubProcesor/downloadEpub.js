import { waitForDownloadActivity } from "./downloadActivity.js";

import { trackOnlineBookDownload, settleOnlineBookDownload } from "./onlineBookDownloads.js";

export function epubFilename(title) {
  const stem = String(title ?? "").normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, "_")
    .trim().replace(/^\.+|\.epub$/gi, "");
  // Sixty Unicode code points fit within a 255-byte filesystem component.
  let name = Array.from(stem).slice(0, 60).join("").replace(/[. ]+$/u, "") || "Book";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = "_" + name;
  return name + ".epub";
}

function observeActivity(downloads, id) {
  return waitForDownloadActivity(id, {
    getItem: async id => (await downloads.search({ id }))[0],
  });
}

export async function saveOpenBook({ file, title, bookId, collectionId }) {
  const filename = epubFilename(title);
  const blob = file.type === "application/epub+zip" ? file : file.slice(0, file.size, "application/epub+zip");
  const url = URL.createObjectURL(blob);
  if (import.meta.env.DEV) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { status: "requested" };
  }

  // Modern Firefox and Chromium expose promise-based downloads in reader pages.
  const { downloads } = globalThis.browser ?? globalThis.chrome;
  let id;
  const release = () => {
    downloads.onChanged.removeListener(onChanged);
    downloads.onErased.removeListener(onErased);
    URL.revokeObjectURL(url);
  };
  const onChanged = delta => {
    if (delta.id === id && ["complete", "interrupted"].includes(delta.state?.current)) release();
  };
  const onErased = erased => { if (erased === id) release(); };
  try {
    id = await downloads.download({ url, filename });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  trackOnlineBookDownload(id, bookId, collectionId);
  downloads.onChanged.addListener(onChanged);
  downloads.onErased.addListener(onErased);
  // A small local file may already have finished before registration.
  const [item] = await downloads.search({ id });
  if (!item || item.state !== "in_progress") {
    release();
    settleOnlineBookDownload(id, item?.state ?? "erased");
  }
  return observeActivity(downloads, id);
}

export async function downloadOriginalSource(url) {
  if (new URL(url).protocol !== "https:") throw new Error("HTTPS source required");
  if (import.meta.env.DEV) {
    window.open(url, "_blank", "noopener,noreferrer");
    return { status: "requested" };
  }
  const api = globalThis.browser ?? globalThis.chrome;
  const response = await api.runtime.sendMessage({ type: "ALLOW_DOWNLOAD", url });
  if (!response?.success || !Number.isInteger(response.downloadId)) {
    throw new Error(response?.error || "Browser did not accept the download");
  }
  return observeActivity(api.downloads, response.downloadId);
}
