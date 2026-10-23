const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function redactPreview(value) {
  return String(value)
    .replace(/("?(?:capability|authorization|token|secret)"?\s*[:=]\s*")([^"]+)(")/gi, "$1[REDACTED]$3")
    .replace(/((?:capability|authorization|token|secret)\s*[=:]\s*)([^\s<>&]+)/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .slice(0, 300);
}

function safeUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/capability|token|secret|key/i.test(key)) url.searchParams.set(key, "[REDACTED]");
  }
  return url.toString();
}

export class HttpJsonError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "HttpJsonError";
    this.details = details;
  }
}

export async function fetchJson(url, options = {}) {
  const {
    attempts = 3,
    timeoutMs = 15000,
    fetchImpl = fetch,
    retryUnexpectedHtml = false,
    ...request
  } = options;
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error("attempts must be between 1 and 3");

  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`HTTP timeout after ${timeoutMs} ms`)), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...request, redirect: "follow", signal: controller.signal });
      const text = await response.text();
      const contentType = response.headers.get("content-type") || "";
      const details = {
        method: request.method || "GET",
        url: safeUrl(url),
        status: response.status,
        finalUrl: safeUrl(response.url || url),
        contentType: contentType || "(missing)",
        first300: redactPreview(text)
      };
      const isJson = /(?:application|text)\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType);
      if (!response.ok || !isJson) {
        const retryable = TRANSIENT_STATUS.has(response.status) || (retryUnexpectedHtml && response.ok && /^text\/html(?:\s*;|$)/i.test(contentType));
        last = new HttpJsonError(formatDiagnostic(details), details);
        if (attempt < attempts && retryable) {
          await wait(300 * attempt);
          continue;
        }
        throw last;
      }
      try {
        return { data: JSON.parse(text), response: details, attempt };
      } catch {
        throw new HttpJsonError(`${formatDiagnostic(details)}; JSON parse failed`, details);
      }
    } catch (error) {
      if (error instanceof HttpJsonError) throw error;
      last = error;
      if (attempt === attempts) throw new Error(`${request.method || "GET"} ${safeUrl(url)} failed after ${attempts} attempts: ${error.message}`);
      await wait(300 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

export function formatDiagnostic(details) {
  return `${details.method} ${details.url} -> HTTP ${details.status}; final URL ${details.finalUrl}; Content-Type ${details.contentType}; first 300 characters: ${details.first300}`;
}
