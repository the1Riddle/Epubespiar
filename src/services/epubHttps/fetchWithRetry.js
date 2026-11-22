const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Retry an entire HTTP read (headers *and* body). A server can return 200 OK
 * then interrupt the response stream; retrying only fetch() misses that case.
 * Do not retry authorization, missing-file or invalid-content errors.
 */
export async function fetchWithRetry(url, retries = 2, {
  fetcher = fetch,
  readResponse = response => response,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetcher(url, { cache: "no-store" });
      if (!response.ok) {
        const error = new Error(`Request failed: HTTP ${response.status} ${response.statusText || ""}`.trim());
        error.httpStatus = response.status;
        throw error;
      }
      return await readResponse(response);
    } catch (error) {
      lastError = error;
      const retryable = error?.httpStatus == null ||
        RETRYABLE_HTTP_STATUS.has(error.httpStatus);
      if (attempt >= retries || !retryable) break;
      console.warn(`EPUB request attempt ${attempt + 1} failed, retrying`, error);
      onRetry({ attempt: attempt + 2, total: retries + 1, error });
      await pause(1000 * (attempt + 1));
    }
  }
  throw lastError;
}
