/** Fail without retrying: a response larger than our safety budget is not transient. */
const sizeLimitError = () =>
  Object.assign(new Error("EPUB download exceeds size limit"), { retryable: false });

/** Read remote EPUBs with a hard byte budget, even without Content-Length. */
export async function readLimitedBlob(response, maxBytes = 100 * 1024 * 1024) {
  const declared = response.headers?.get("content-length");
  if (declared !== null && declared !== undefined && declared !== "") {
    const expected = Number(declared);
    if (Number.isFinite(expected) && expected > maxBytes) {
      throw sizeLimitError();
    }
  }

  if (!response.body?.getReader) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw sizeLimitError();
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw sizeLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, {
    type: response.headers?.get("content-type") || "application/epub+zip",
  });
}
