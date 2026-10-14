const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8081';

export class BackendError extends Error {
  constructor(message, { status, code = 'BACKEND_ERROR' } = {}) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.code = code;
  }
}

export function createBackendClient({
  baseUrl = process.env.BACKEND_URL || DEFAULT_BACKEND_URL,
  apiKey = process.env.INSAUTO_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('BACKEND_URL must be an HTTP(S) URL without embedded credentials.');
  }
  if (base.search || base.hash) {
    throw new Error('BACKEND_URL must not include a query or fragment.');
  }
  const apiRoot = `${base.href.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1`;
  if (!apiKey?.trim()) {
    throw new Error('Set INSAUTO_API_KEY to the same key configured on the InsAuto backend.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('The backend timeout must be between 1 and 30000 milliseconds.');
  }

  async function request(path, { method = 'GET', body, requestTimeoutMs = timeoutMs } = {}) {
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 360_000) {
      throw new Error('The request timeout must be between 1 and 360000 milliseconds.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(`${apiRoot}${path}`, {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: 'error',
      });
      const raw = await response.text();
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        throw new BackendError('The backend returned an invalid JSON response.', {
          status: response.status,
          code: 'INVALID_BACKEND_RESPONSE',
        });
      }
      if (!response.ok) {
        const detail = payload?.detail || payload?.message || `Backend request failed (${response.status}).`;
        throw new BackendError(String(detail).replaceAll(apiKey, '[redacted]').slice(0, 1000), {
          status: response.status,
          code: typeof payload?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(payload.code)
            ? payload.code : 'BACKEND_HTTP_ERROR',
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof BackendError) throw error;
      if (controller.signal.aborted) {
        throw new BackendError('The backend request timed out. A mutation may have completed. Never retry publication automatically; check saved status and the platform first.', {
          code: 'BACKEND_TIMEOUT',
        });
      }
      throw new BackendError('Cannot reach the InsAuto backend. Check BACKEND_URL and the backend. A mutation may have completed; never retry publication automatically.', {
        code: 'BACKEND_UNAVAILABLE',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return { request };
}
