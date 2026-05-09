import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFLINE_QUEUE_KEY = 'asel.offline.queue.v1';

export interface QueuedApiRequest {
  id: string;
  path: string;
  method: string;
  body: string;
  createdAt: string;
  tag?: string;
  ownerId?: string;
}

async function readQueue(): Promise<QueuedApiRequest[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isQueuedApiRequest) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueuedApiRequest[]) {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.slice(-100)));
}

function isQueuedApiRequest(value: unknown): value is QueuedApiRequest {
  const item = value as Partial<QueuedApiRequest>;
  return Boolean(item?.id && item.path && item.method && item.body && item.createdAt);
}

export async function enqueueOfflineRequest(request: QueuedApiRequest) {
  const queue = await readQueue();
  if (queue.some((item) => item.id === request.id)) return queue.length;
  const next = [...queue, request];
  await writeQueue(next);
  return next.length;
}

export async function getOfflineQueue(ownerId?: string) {
  const queue = await readQueue();
  if (!ownerId) return queue;
  return queue.filter((item) => !item.ownerId || item.ownerId === ownerId);
}

export async function removeOfflineRequest(id: string) {
  const queue = await readQueue();
  await writeQueue(queue.filter((item) => item.id !== id));
}

export async function clearOfflineQueue() {
  await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
}

export async function offlineQueueCount(ownerId?: string) {
  return getOfflineQueue(ownerId).then((queue) => queue.length);
}
