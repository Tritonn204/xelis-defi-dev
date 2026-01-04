import { useState, useCallback } from 'react';
import { getJSON, sendJSON } from '../util/api';

export function useApi() {  // No token param needed!
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiFetch = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      const method = (options.method || 'GET').toUpperCase();

      if (method === 'GET') {
        return await getJSON(endpoint);
      }

      let bodyObj: any = undefined;
      if (options.body !== undefined) {
        bodyObj = typeof options.body === 'string' 
          ? JSON.parse(options.body) 
          : options.body;
      }

      if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
        throw new Error(`Unsupported method ${method}`);
      }

      return await sendJSON(method as 'POST' | 'PUT' | 'DELETE', endpoint, bodyObj);
    } catch (err: any) {
      const message = err?.message || 'Request failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []); // No dependencies needed

  return { apiFetch, loading, error };
}