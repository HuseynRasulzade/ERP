const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
  correlationId?: string;
}

export class ApiError extends Error {
  code: string;
  fieldErrors?: Record<string, string[]>;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors;
  }
}

const storage = {
  get accessToken() {
    return localStorage.getItem('accessToken');
  },
  get refreshToken() {
    return localStorage.getItem('refreshToken');
  },
  get tenantId() {
    return localStorage.getItem('tenantId');
  },
  setTokens(accessToken: string, refreshToken: string) {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  },
  setTenantId(tenantId: string | null) {
    if (tenantId) localStorage.setItem('tenantId', tenantId);
    else localStorage.removeItem('tenantId');
  },
  clear() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('tenantId');
  },
};

/** Fired when the session can no longer be authenticated (refresh failed).
 * AuthContext listens for this to bounce the user back to /login. */
export const SESSION_EXPIRED_EVENT = 'session-expired';

let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!storage.refreshToken) return false;
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: storage.refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const body = await res.json();
        storage.setTokens(body.accessToken, body.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipTenant?: boolean;
  skipAuth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (!options.skipAuth && storage.accessToken) {
    headers.Authorization = `Bearer ${storage.accessToken}`;
  }
  if (!options.skipTenant && storage.tenantId) {
    headers['X-Tenant-Id'] = storage.tenantId;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !options.skipAuth && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, options, true);
    storage.clear();
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    throw new ApiError(401, { code: 'UNAUTHENTICATED', message: 'Session expired' });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body ?? { code: 'UNKNOWN', message: 'Request failed' });
  }

  return body as T;
}

/** Multipart file upload — bypasses the JSON request() helper since the
 * browser must set its own `Content-Type: multipart/form-data; boundary=…`
 * header for a FormData body (never set it manually). */
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  if (storage.accessToken) headers.Authorization = `Bearer ${storage.accessToken}`;
  if (storage.tenantId) headers['X-Tenant-Id'] = storage.tenantId;

  const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: formData });
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, body ?? { code: 'UNKNOWN', message: 'Upload failed' });
  return body as T;
}

/** Authenticated binary download — a plain `<a href>`/`<img src>` can't
 * carry the Authorization header, so fetch as a Blob and let the caller
 * open/save it via a temporary object URL. */
async function downloadBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (storage.accessToken) headers.Authorization = `Bearer ${storage.accessToken}`;
  if (storage.tenantId) headers['X-Tenant-Id'] = storage.tenantId;

  const res = await fetch(`${API_URL}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, { code: 'UNKNOWN', message: 'Download failed' });
  return res.blob();
}

export const api = {
  get: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
  upload,
  downloadBlob,
};

export const session = storage;
