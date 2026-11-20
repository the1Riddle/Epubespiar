export const normalizePath = (path) => String(path || "").replace(/^\/+/, "");
export const toTokenList = (value) =>
  String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

export const resolvePath = (basePath, relativePath) => {
  if (!relativePath) return "";
  if (relativePath.startsWith("data:") || relativePath.startsWith("blob:"))
    return relativePath;
  if (relativePath.startsWith("/")) return relativePath.slice(1);

  const baseParts = normalizePath(basePath).split("/").filter(Boolean);
  const relParts = relativePath.split("/");

  for (const part of relParts) {
    if (part === "..") {
      baseParts.pop();
    } else if (part && part !== ".") {
      baseParts.push(part);
    }
  }

  return baseParts.join("/");
};

/**
 * Resolve a resource reference to the exact member name stored in the EPUB ZIP.
 * Unlike spine/TOC hrefs, ZIP lookups must discard query and fragment
 * components and decode percent-encoded filenames (including spaces).
 * Preserve the original spelling for archives that literally use '%' in names.
 */
export const resolveArchivePath = (basePath, reference, files) => {
  if (!reference || /^(?:data|blob|https?|javascript):/i.test(reference))
    return "";

  const bareReference = String(reference).split(/[?#]/, 1)[0];
  if (!bareReference) return "";
  const unresolved = resolvePath(basePath, bareReference);
  if (!unresolved) return "";

  let decoded;
  try {
    decoded = bareReference
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    decoded = bareReference;
  }

  // Encoded separators or traversal components must never change ZIP
  // directory boundaries. Only decode the individual filename segments.
  const segments = decoded.split("/");
  if (segments.some((segment) =>
    segment.includes("/") || segment.includes("\\") ||
    (segment !== "." && segment !== ".." && /[\u0000-\u001f]/.test(segment))
  )) return "";

  const canonical = resolvePath(basePath, decoded);
  // Prefer the decoded member; fall back for archives with literal '%' names.
  if (files?.[canonical]) return canonical;
  if (files?.[unresolved]) return unresolved;
  return canonical;
};
