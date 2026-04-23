import axios, { AxiosError } from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15_000,
});

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export function apiError(err: unknown): ApiErrorPayload {
  if (err instanceof AxiosError) {
    const payload = err.response?.data?.error;
    if (payload) return payload as ApiErrorPayload;
    if (err.code === 'ECONNABORTED') return { code: 'TIMEOUT', message: 'La requête a expiré' };
    return { code: 'NETWORK', message: err.message || 'Erreur réseau' };
  }
  return { code: 'UNKNOWN', message: 'Erreur inattendue' };
}

/**
 * Global 401 handler. Registered once from AuthContext so an expired
 * session on any request bounces the user to the login page instead of
 * silently rendering empty lists.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      // Ignore 401s from the /auth/me boot probe — AuthContext expects them.
      const url = err.config?.url ?? '';
      if (!url.endsWith('/auth/me') && onUnauthorized) onUnauthorized();
    }
    return Promise.reject(err);
  },
);
