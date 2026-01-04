import { API_BASE } from '../config';

let csrfToken: string | null = null;

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  
  const res = await fetch(`${API_BASE}/api/csrf-token`, { 
    credentials: 'include' 
  });
  
  if (!res.ok) {
    throw new Error('Failed to fetch CSRF token');
  }
  
  const json = await res.json();
  csrfToken = json.csrfToken;
  return csrfToken!;
}

export async function getJSON(url: string) {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  
  const res = await fetch(fullUrl, { 
    credentials: 'include' 
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  
  return res.json();
}

export async function sendJSON(
  method: 'POST' | 'PUT' | 'DELETE', 
  url: string, 
  body?: any
) {
  const token = await ensureCsrf();
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
  
  const res = await fetch(fullUrl, {
    method,
    credentials: 'include',
    headers: { 
      'Content-Type': 'application/json', 
      'X-CSRF-Token': token 
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  // Only attempt refresh for 401 errors, and NEVER for auth endpoints
  const isAuthEndpoint = url.includes('/api/auth/');
  
  if (res.status === 401 && !isAuthEndpoint) {
    try {
      // Try to refresh the session
      await sendJSON('POST', '/api/auth/refresh');
      
      // Retry the original request once
      const retryRes = await fetch(fullUrl, {
        method,
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json', 
          'X-CSRF-Token': token 
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      
      if (!retryRes.ok) {
        const error = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
        throw new Error(error.error || 'Request failed');
      }
      
      return retryRes.json();
    } catch (refreshError) {
      // Refresh failed - just throw the error, don't redirect
      // Let the AuthContext handle the state
      throw refreshError;
    }
  }
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  
  return res.json();
}

export function clearCsrfToken() {
  csrfToken = null;
}