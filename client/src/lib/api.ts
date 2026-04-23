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
