import * as SecureStore from 'expo-secure-store';
import {
  clearOfflineQueue,
  enqueueOfflineRequest,
  getOfflineQueue,
  offlineQueueCount,
  removeOfflineRequest,
} from './offlineQueue';
import type { User } from './types';

export const SESSION_COOKIE_KEY = 'asel.session.cookie';
export const SESSION_TOKEN_KEY = 'asel.session.token';
export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

interface ApiErrorPayload {
  code?: string;
  message?: string;
}

interface ApiFetchInit extends RequestInit {
  queueOnNetworkError?: boolean;
  queueOwnerId?: string;
  queueTag?: string;
  skipQueue?: boolean;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function cookieValue(raw: string | null): string {
  if (!raw) return '';
  return raw.split(',').map((part) => part.trim()).find((part) => part.startsWith('asel_session='))?.split(';')[0] ?? raw.split(';')[0] ?? '';
}

function clientRequestId() {
  return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function prepareQueueableBody(body: BodyInit | null | undefined) {
  if (typeof body !== 'string') return { body, requestId: clientRequestId() };
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const requestId = typeof parsed.clientRequestId === 'string' && parsed.clientRequestId
      ? parsed.clientRequestId
      : clientRequestId();
    return {
      body: JSON.stringify({ ...parsed, clientRequestId: requestId }),
      requestId,
    };
  } catch {
    return { body, requestId: clientRequestId() };
  }
}

export function isSessionExpiredError(error: unknown) {
  return error instanceof ApiRequestError && error.status === 401;
}

export function isOfflineQueuedError(error: unknown) {
  return error instanceof ApiRequestError && error.code === 'OFFLINE_QUEUED';
}

export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const {
    queueOnNetworkError = false,
    queueOwnerId,
    queueTag,
    skipQueue = false,
    ...requestInit
  } = init;
  const [sessionCookie, sessionToken] = await Promise.all([
    SecureStore.getItemAsync(SESSION_COOKIE_KEY),
    SecureStore.getItemAsync(SESSION_TOKEN_KEY),
  ]);
  const headers = new Headers(requestInit.headers);
  headers.set('Accept', 'application/json');
  if (!(requestInit.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (sessionCookie) headers.set('Cookie', sessionCookie);
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);

  const method = String(requestInit.method ?? 'GET').toUpperCase();
  const canQueue = queueOnNetworkError && !skipQueue && method !== 'GET' && typeof requestInit.body === 'string';
  const prepared = canQueue ? prepareQueueableBody(requestInit.body) : { body: requestInit.body, requestId: clientRequestId() };
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...requestInit,
      body: prepared.body,
      headers,
      credentials: 'include',
    });
  } catch {
    if (canQueue && typeof prepared.body === 'string') {
      await enqueueOfflineRequest({
        id: prepared.requestId,
        path,
        method,
        body: prepared.body,
        createdAt: new Date().toISOString(),
        tag: queueTag,
        ownerId: queueOwnerId,
      });
      throw new ApiRequestError('Connexion instable: action gardee hors ligne, elle sera synchronisee au retour du reseau.', 0, 'OFFLINE_QUEUED');
    }
    throw new ApiRequestError('Connexion impossible. Verifiez internet puis reessayez.', 0, 'NETWORK_ERROR');
  }

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    await SecureStore.setItemAsync(SESSION_COOKIE_KEY, cookieValue(setCookie));
  }

  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      error: {
        message: text
          ? `Reponse serveur non JSON (${response.status}): ${text.slice(0, 140)}`
          : `Reponse serveur vide (${response.status})`,
      },
    };
  }
  if (!response.ok) {
    if (response.status === 401) {
      await clearSession();
    }
    const payload = (((data as { error?: unknown })?.error ?? data) as ApiErrorPayload);
    const message = response.status === 401
      ? 'Session expiree. Connectez-vous a nouveau.'
      : payload.message || `HTTP ${response.status}`;
    throw new ApiRequestError(message, response.status, payload.code);
  }
  return data as T;
}

export async function flushQueuedApiRequests(ownerId?: string) {
  const queue = await getOfflineQueue(ownerId);
  let sent = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      await apiFetch(item.path, {
        method: item.method,
        body: item.body,
        skipQueue: true,
      });
      await removeOfflineRequest(item.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      if (isSessionExpiredError(error)) throw error;
      break;
    }
  }

  return {
    sent,
    failed,
    remaining: await offlineQueueCount(ownerId),
  };
}

export async function getQueuedApiRequestCount(ownerId?: string) {
  return offlineQueueCount(ownerId);
}

export async function login(username: string, password: string): Promise<User> {
  const data = await apiFetch<{ user: User; token?: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.token) await SecureStore.setItemAsync(SESSION_TOKEN_KEY, data.token);
  return data.user;
}

export async function loadMe(): Promise<User | null> {
  try {
    const data = await apiFetch<{ user: User }>('/auth/me');
    return data.user;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    await clearSession({ clearQueue: true });
  }
}

async function clearSession(options: { clearQueue?: boolean } = {}) {
  const jobs: Array<Promise<unknown>> = [
    SecureStore.deleteItemAsync(SESSION_COOKIE_KEY),
    SecureStore.deleteItemAsync(SESSION_TOKEN_KEY),
  ];
  if (options.clearQueue) jobs.push(clearOfflineQueue());
  await Promise.all(jobs);
}
