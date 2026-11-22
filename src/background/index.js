import browser from "webextension-polyfill";
import { canLoadLocalFileFromReader } from "./downloadPolicy.js";


// Rate limiting configuration
const RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 50
};

// Message rate limiting
const messageRateLimit = new Map();

// Track open reader tabs with their instance IDs
const readerTabs = new Map();
const processedDownloads = new Set();
const examiningDownloads = new Set();

// Function to generate random instance ID
function generateInstanceId() {
  return Math.random().toString(36).substring(2, 15);
}

function isSafeSupportedUrl(url) {
  try {
    const urlObj = new URL(url);
    return (urlObj.protocol === 'https:' || urlObj.protocol === 'file:') &&
           urlObj.pathname.length < 2048; // Prevent path traversal
  } catch {
    return false;
  }
}

function isLikelyEpubUrl(url) {
  if (!isSafeSupportedUrl(url)) {
    return false;
  }

  try {
    const urlObj = new URL(url);
    const combined = `${decodeURIComponent(urlObj.pathname)}${decodeURIComponent(urlObj.search || '')}`.toLowerCase();
    return /\.epub($|[./?&#_-])/i.test(combined);
  } catch {
    return false;
  }
}

function isLikelyEpubFilename(filename = '') {
  if (!filename) {
    return false;
  }
  return /\.epub($|\.)/i.test(filename.toLowerCase());
}

// Validate EPUB URL
function isValidEpubUrl(url) {
  return isLikelyEpubUrl(url);
}

// Check rate limit
function checkRateLimit(senderId) {
  const now = Date.now();
  const userLimit = messageRateLimit.get(senderId) || { count: 0, resetTime: now + RATE_LIMIT.windowMs };
  
  if (now > userLimit.resetTime) {
    userLimit.count = 0;
    userLimit.resetTime = now + RATE_LIMIT.windowMs;
  }
  
  if (userLimit.count >= RATE_LIMIT.max) {
    return false;
  }
  
  userLimit.count++;
  messageRateLimit.set(senderId, userLimit);
  return true;
}

// Function to open or focus the reader tab
async function openReaderTab(epubUrl = null, isNewInstance = false, options = {}) {
  try {
    const allowSafeNonEpubUrl = options.allowSafeNonEpubUrl === true;

    if (epubUrl && !(isValidEpubUrl(epubUrl) || (allowSafeNonEpubUrl && isSafeSupportedUrl(epubUrl)))) {
      throw new Error('Invalid EPUB file URL');
    }

    const readerURL = browser.runtime.getURL("reader.html");
    const instanceId = generateInstanceId();
    const finalURL = epubUrl 
      ? `${readerURL}?file=${encodeURIComponent(epubUrl)}&instance=${instanceId}`
      : `${readerURL}?instance=${instanceId}`;
    
    // Always create a new tab with a unique instance ID
    const tab = await browser.tabs.create({ url: finalURL });
    readerTabs.set(tab.id, instanceId);
    return tab;
  } catch (error) {
    console.error('Error opening reader tab:', error);
    browser.runtime.sendMessage({
      type: 'SHOW_NOTIFICATION',
      notification: {
        type: 'error',
        message: 'Failed to open reader'
      }
    }).catch(console.error);
    throw error;
  }
}

// Handle extension installation
browser.runtime.onInstalled.addListener((details) => {
  console.log("Extension installed:", details);
});

// Listen for browser action (toolbar icon) clicks
browser.action.onClicked.addListener((tab) => {
  openReaderTab(null, true).catch((error) => {
    console.error('Error handling browser action click:', error);
  });
});

// A short-lived exception prevents the browser's own download request from
// immediately being intercepted by the reader again. The extension ID check
// handles browsers that report byExtensionId; the URL token is a fallback.
const allowedDownloads = new Map();
const ALLOW_DOWNLOAD_TTL_MS = 120_000;

function isAuthorizedReaderDownload(sender, url) {
  if (sender?.id !== browser.runtime.id || typeof url !== 'string') return false;
  try {
    const target = new URL(url);
    const source = new URL(sender.url || '');
    const reader = new URL(browser.runtime.getURL('reader.html'));
    return target.protocol === 'https:' && isSafeSupportedUrl(url) &&
      source.origin === reader.origin && source.pathname === reader.pathname &&
      source.searchParams.get('file') === url;
  } catch {
    return false;
  }
}

function consumeAllowedDownload(downloadItem) {
  const url = downloadItem.url;
  const token = allowedDownloads.get(url);
  if (token) allowedDownloads.delete(url);
  // A download created by this extension is always an intentional handoff.
  return downloadItem.byExtensionId === browser.runtime.id ||
    (token !== undefined && token > Date.now());
}

async function handlePotentialEpubDownload(downloadItem) {
  if (!downloadItem || processedDownloads.has(downloadItem.id) ||
      examiningDownloads.has(downloadItem.id)) {
    return;
  }

  examiningDownloads.add(downloadItem.id);
  try {
    const urlObj = new URL(downloadItem.url);
    const isFileEpub = urlObj.protocol === 'file:' && isLikelyEpubUrl(downloadItem.url);

    if (isFileEpub) {
      // Firefox extension pages cannot fetch file:// URLs (Bugzilla 2085199).
      // Never cancel a local file when the reader cannot load it.
      if (!canLoadLocalFileFromReader(browser.runtime.getURL('reader.html'))) return;
      processedDownloads.add(downloadItem.id);
      // If tab creation fails, leave the user's original download intact.
      await openReaderTab(downloadItem.url, false, { allowSafeNonEpubUrl: true });
      await browser.downloads.cancel(downloadItem.id);
      await browser.downloads.erase({ id: downloadItem.id });
      return;
    }

    if (urlObj.protocol !== 'https:') {
      return;
    }

    if (consumeAllowedDownload(downloadItem)) return;

    const result = await browser.storage.local.get('interceptDownloads');
    const interceptEnabled = result.interceptDownloads === true;

    if (!interceptEnabled) {
      return;
    }

    const mimeType = (downloadItem.mime || '').toLowerCase();
    const isEpubByUrl = isLikelyEpubUrl(downloadItem.url);
    const isEpubByFilename = isLikelyEpubFilename(downloadItem.filename);
    const isEpubByMime = mimeType === 'application/epub+zip';

    if (isEpubByUrl || isEpubByFilename || isEpubByMime) {
      processedDownloads.add(downloadItem.id);
      await browser.downloads.cancel(downloadItem.id);
      await browser.downloads.erase({ id: downloadItem.id });
      await openReaderTab(downloadItem.url, false, { allowSafeNonEpubUrl: true });
    }
  } catch (error) {
    console.error('Error processing potential EPUB download:', error);
  } finally {
    examiningDownloads.delete(downloadItem.id);
  }
}

// Intercept downloads with toggle support
browser.downloads.onCreated.addListener(async (downloadItem) => {
  await handlePotentialEpubDownload(downloadItem);
});

browser.downloads.onChanged.addListener(async (delta) => {
  if (processedDownloads.has(delta.id)) {
    if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
      processedDownloads.delete(delta.id);
    }
    return;
  }

  const hasRelevantChange = Boolean(delta.filename || delta.mime || delta.finalUrl || delta.state);
  if (!hasRelevantChange) {
    return;
  }

  try {
    const [downloadItem] = await browser.downloads.search({ id: delta.id });
    if (!downloadItem) {
      return;
    }

    if (downloadItem.state === 'interrupted' || downloadItem.state === 'complete') {
      return;
    }

    await handlePotentialEpubDownload(downloadItem);
  } catch (error) {
    console.error('Error handling download change:', error);
  }
});

// Clean up download IDs after the browser removes the item.
browser.downloads.onErased.addListener((downloadId) => {
  processedDownloads.delete(downloadId);
});

// Handle tab removal
browser.tabs.onRemoved.addListener((tabId) => {
  readerTabs.delete(tabId);
});

// Handle protocol registration
browser.runtime.onMessage.addListener((message, sender) => {
  // Return a promise for proper async handling
  return new Promise((resolve, reject) => {
    // Check rate limit
    if (!checkRateLimit(sender.id)) {
      reject(new Error('Rate limit exceeded'));
      return;
    }

    if (message.type === 'OPEN_READER' && message.epubUrl) {
      openReaderTab(message.epubUrl)
        .then(() => resolve({ success: true }))
        .catch(() => {
          console.error('Error handling message');
          reject(new Error('Failed to open reader'));
        });
    } else if (message.type === 'EPUB_DRAGSTART') {
      // Tell content script it's okay to handle this drag
      resolve({ shouldHandle: isValidEpubUrl(message.url) });
    } else if (message.type === 'EPUB_DROP') {
      if (isValidEpubUrl(message.url)) {
        openReaderTab(message.url)
          .then(() => resolve({ success: true }))
          .catch(() => {
            console.error('Error handling message');
            reject(new Error('Failed to open reader'));
          });
      } else {
        reject(new Error('Invalid EPUB URL'));
      }
    } else if (message.type === 'ALLOW_DOWNLOAD') {
      // Only an actual reader page may download its own original source URL.
      // Many EPUB downloads use opaque /download/<id> endpoints without .epub.
      if (!isAuthorizedReaderDownload(sender, message.url)) {
        reject(new Error('Unauthorized EPUB download request'));
        return;
      }
      const now = Date.now();
      for (const [url, expiry] of allowedDownloads) {
        if (expiry <= now) allowedDownloads.delete(url);
      }
      allowedDownloads.set(message.url, now + ALLOW_DOWNLOAD_TTL_MS);
      browser.downloads.download({ url: message.url })
        .then((id) => {
          resolve({ success: true, downloadId: id });
        })
        .catch((err) => {
          console.error('Browser download request failed:', err);
          allowedDownloads.delete(message.url);
          reject(new Error('Browser could not start download: ' + err.message));
        });
    } else {
      resolve({ success: false, error: 'Invalid message type' });
    }
  });
});

