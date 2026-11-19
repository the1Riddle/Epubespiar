/**
 * Security utility functions for the extension
 */

/**
 * Validate file type and size
 * @param {File} file - File to validate
 * @param {number} maxSize - Maximum file size in bytes
 * @param {string[]} allowedTypes - Array of allowed MIME types
 * @returns {boolean} Whether the file is valid
 */
export function validateFile(file, maxSize, allowedTypes) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return false;
  if (file.size > maxSize) return false;
  // Browsers may report an empty MIME type for locally selected .epub files.
  // This is only a preliminary check; the ZIP and EPUB parser still validates content.
  return allowedTypes.includes(file.type) ||
    ((file.type === "" || file.type === "application/octet-stream") &&
      /\.epub$/i.test(file.name || ""));
}

/**
 * Validate URL for security
 * @param {string} url - URL to validate
 * @returns {boolean} Whether the URL is secure
 */
export function validateURL(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'file:';
  } catch {
    return false;
  }
}

/**
 * Sanitize filename to prevent path traversal and XSS
 * @param {string} filename - Filename to sanitize
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(filename) {
  if (!filename) return 'book.epub';
  
  // Remove any path separators and dangerous characters
  let sanitized = filename
    .replace(/[/\\]/g, '') // Remove path separators
    .replace(/\.\./g, '') // Remove parent directory references
    .replace(/[<>:"|?*\x00-\x1F]/g, '') // Remove special characters and control characters
    .trim();
  
  // If empty after sanitization, use default
  if (!sanitized) return 'book.epub';
  
  // Ensure it's a reasonable length (max 255 chars)
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }
  
  return sanitized;
}
