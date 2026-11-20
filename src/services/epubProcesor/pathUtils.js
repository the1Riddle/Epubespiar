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

  // Decode each filename component without letting encoded slashes or
  // backslashes create new path components.
  let decoded;
  try {
    const segments = bareReference.split("/").map((part) =>
      decodeURIComponent(part)
    );
    if (segments.some((part) =>
      part.includes("/") || part.includes("\\") || /[\u0000-\u001f]/.test(part)
    )) return "";
    decoded = segments.join("/");
  } catch {
    decoded = bareReference;
  }

  const canonical = resolvePath(basePath, decoded);
  // Prefer the decoded member; fall back for archives with literal '%' names.
  if (files?.[canonical]) return canonical;
  if (files?.[unresolved]) return unresolved;
  return canonical;
};
