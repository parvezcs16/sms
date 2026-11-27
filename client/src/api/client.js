const TOKEN_KEY = 'sms_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// True when the request never reached the server (Wi-Fi dropped, server PC
// off, firewall) as opposed to the server answering with an error.
export function isNetworkError(err) {
  return !(err instanceof ApiError);
}

async function request(path, { method = 'GET', body, isForm = false, ...rest } = {}) {
  const headers = { ...(rest.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    cache: 'no-store',
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined
  });

  if (response.status === 401) {
    setToken(null);
    if (!path.startsWith('/auth/login') && window.location.pathname !== '/login') {
      const here = window.location.pathname + window.location.search;
      window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => null);
      if (data && data.error) message = data.error;
    }
    throw new ApiError(message, response.status);
  }

  if (contentType.includes('application/json')) return response.json();
  return response;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData, isForm: true })
};

// Triggers a browser download for endpoints that stream files (PDF/Excel/DOCX).
export async function downloadFile(path, fallbackName) {
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!response.ok) throw new ApiError(`Download failed (${response.status})`, response.status);
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const fileName = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export { ApiError };
