import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from './types';

export const SESSION_COOKIE_KEY = 'asel.session.cookie';
export const SESSION_TOKEN_KEY = 'asel.session.token';
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://asel.saleheddinetouil.tech/api';

interface ApiErrorPayload {
  code?: string;
  message?: string;
}

function cookieValue(raw: string | null): string {
  if (!raw) return '';
  return raw.split(',').map((part) => part.trim()).find((part) => part.startsWith('asel_session='))?.split(';')[0] ?? raw.split(';')[0] ?? '';
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [sessionCookie, sessionToken] = await Promise.all([
    AsyncStorage.getItem(SESSION_COOKIE_KEY),
    AsyncStorage.getItem(SESSION_TOKEN_KEY),
  ]);
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (sessionCookie) headers.set('Cookie', sessionCookie);
  if (sessionToken) headers.set('Authorization', `Bearer ${sessionToken}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    await AsyncStorage.setItem(SESSION_COOKIE_KEY, cookieValue(setCookie));
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
      await AsyncStorage.multiRemove([SESSION_COOKIE_KEY, SESSION_TOKEN_KEY]);
    }
    const payload = (((data as { error?: unknown })?.error ?? data) as ApiErrorPayload);
    throw new Error(payload.message || `HTTP ${response.status}`);
  }
  return data as T;
}

export async function login(username: string, password: string): Promise<User> {
  const data = await apiFetch<{ user: User; token?: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (data.token) await AsyncStorage.setItem(SESSION_TOKEN_KEY, data.token);
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
    await AsyncStorage.multiRemove([SESSION_COOKIE_KEY, SESSION_TOKEN_KEY]);
  }
}
