import axios, { AxiosError } from 'axios';

export const AUTH_EXPIRED_EVENT = 'asel:auth-expired';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 60_000,
});

api.interceptors.response.use(
  (response) => response,
  (err: unknown) => {
    if (err instanceof AxiosError && err.response?.status === 401) {
      const url = err.config?.url ?? '';
      if (!url.includes('/auth/login') && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
      }
    }
    return Promise.reject(err);
  },
);

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export function apiError(err: unknown): ApiErrorPayload {
  if (err instanceof AxiosError) {
    const payload = err.response?.data?.error;
    if (payload) return payload as ApiErrorPayload;
    return { code: 'NETWORK', message: err.message };
  }
  return { code: 'UNKNOWN', message: 'Unexpected error' };
}

export function uploadUrl(path?: string | null): string {
  if (!path) return '';
  const clean = path.replace(/^\/+/, '');
  const encoded = clean
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `/api/uploads/${encoded}`;
}
