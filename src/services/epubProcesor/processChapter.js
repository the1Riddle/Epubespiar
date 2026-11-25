import { resolveArchivePath } from "./pathUtils.js";

// JSZip's async('blob') creates an untyped Blob. Give extracted images their
// MIME type so Chromium and Firefox can decode them consistently from blob: URLs.
const IMAGE_MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml"
};

function imageBlobFromBytes(bytes, path) {
  const ext = path.split("?")[0].split(".").pop()?.toLowerCase();
  return new Blob([bytes], { type: IMAGE_MIME_TYPES[ext] || "application/octet-stream" });
}

const stripFontFaceRules = (cssText) =>
  cssText.replace(/@font-face\s*{[\s\S]*?}/gi, "");

const processCssUrls = async (
  cssText,
  zip,
  cssPath,
  createTrackedObjectUrl,
) => {
  const cssBasePath = cssPath.includes("/")
    ? cssPath.substring(0, cssPath.lastIndexOf("/"))
    : "";
  const urlPattern = /url\(['"]?([^'")]+)['"]?\)/g;
  const cssWithoutFontFaces = stripFontFaceRules(cssText);
  const matches = [...cssWithoutFontFaces.matchAll(urlPattern)];
  let updated = cssWithoutFontFaces;

  for (const match of matches) {
    const original = match[1];
    if (
      !original ||
      original.startsWith("data:") ||
      original.startsWith("blob:")
    )
      continue;

    const resolved = resolveArchivePath(cssBasePath, original, zip.files);
    const file = zip.file(resolved);
    if (!file) continue;

    try {
      const bytes = await file.async("uint8array");
      const blobUrl = createTrackedObjectUrl(imageBlobFromBytes(bytes, resolved));
      updated = updated.replace(match[0], `url('${blobUrl}')`);
    } catch (error) {
      console.warn("Unable to process CSS asset:", resolved, error);
    }
  }

  return updated;
};

export const parseAndProcessChapter = async (
  chapterContent,
  zip,
  basePath,
  createTrackedObjectUrl,
) => {
  const parser = new DOMParser();
  const xhtmlDoc = parser.parseFromString(
    chapterContent,
    "application/xhtml+xml",
  );
  const parseError = xhtmlDoc.querySelector("parsererror");
  const doc = parseError
    ? parser.parseFromString(chapterContent, "text/html")
    : xhtmlDoc;

  const links = doc.querySelectorAll("link[rel='stylesheet']");
  for (const link of Array.from(links)) {
    const href = link.getAttribute("href") || "";
    const resolved = resolveArchivePath(basePath, href, zip.files);
    const file = zip.file(resolved);
    if (!file) continue;

    try {
      const cssContent = await file.async("string");
      const processedCss = await processCssUrls(
        cssContent,
        zip,
        resolved,
        createTrackedObjectUrl,
      );
      /**
       * Inline the CSS instead of linking a blob: URL.
       * fixing the blocked blob stylesheets in firefox.
       */
      const styleTag = doc.createElement("style");
      styleTag.textContent = processedCss;
      const media = link.getAttribute("media");
      if (media) styleTag.setAttribute("media", media);
      link.replaceWith(styleTag);
    } catch (error) {
      console.warn("Unable to process stylesheet:", resolved, error);
    }
  }

  const styleTags = doc.querySelectorAll("style");
  for (const styleTag of Array.from(styleTags)) {
    if (!styleTag.textContent) {
      continue;
    }
    styleTag.textContent = await processCssUrls(
      styleTag.textContent,
      zip,
      basePath,
      createTrackedObjectUrl,
    );
  }

  const images = doc.querySelectorAll("img");
  for (const image of Array.from(images)) {
    const src = image.getAttribute("src") || "";
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) continue;

    const resolved = resolveArchivePath(basePath, src, zip.files);
    const file = zip.file(resolved);
    if (!file) continue;

    try {
      const bytes = await file.async("uint8array");
      image.setAttribute("src", createTrackedObjectUrl(imageBlobFromBytes(bytes, resolved)));
    } catch (error) {
      console.warn("Unable to process image:", resolved, error);
    }
  }

  const svgImages = doc.querySelectorAll("image");
  for (const image of Array.from(svgImages)) {
    const href =
      image.getAttribute("xlink:href") || image.getAttribute("href") || "";
    if (!href || href.startsWith("data:") || href.startsWith("blob:")) continue;

    const resolved = resolveArchivePath(basePath, href, zip.files);
    const file = zip.file(resolved);
    if (!file) continue;

    try {
      const bytes = await file.async("uint8array");
      const blobUrl = createTrackedObjectUrl(imageBlobFromBytes(bytes, resolved));
      image.setAttribute("href", blobUrl);
      image.removeAttribute("xlink:href");
    } catch (error) {
      console.warn("Unable to process SVG image:", resolved, error);
    }
  }

  // Serialize the parsed tree as HTML so XHTML namespace prefixes become
  // ordinary HTML tag names before highlighting and native sanitization.
  const template = document.createElement("template");
  template.content.append(doc.documentElement);
  return template.innerHTML;
};
