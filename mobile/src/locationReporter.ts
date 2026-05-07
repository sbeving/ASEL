import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { apiFetch } from './api';
import { collectDeviceIntegrity } from './integrity';

export const LOCATION_TASK_NAME = 'asel-commercial-location-ping';
const FIVE_MINUTES_MS = 5 * 60 * 1000;

type LocationTaskData = {
  locations?: Location.LocationObject[];
};

async function postLocation(location: Location.LocationObject, source: 'mobile_foreground' | 'mobile_background') {
  const integrity = await collectDeviceIntegrity(location);
  await apiFetch('/location-pings', {
    method: 'POST',
    body: JSON.stringify({
      source,
      timestamp: new Date(location.timestamp).toISOString(),
      gps: {
        lat: Number(location.coords.latitude.toFixed(6)),
        lng: Number(location.coords.longitude.toFixed(6)),
        accuracy: location.coords.accuracy,
        heading: location.coords.heading,
        speed: location.coords.speed,
        mocked: (location as Location.LocationObject & { mocked?: boolean }).mocked ?? null,
      },
      integrity,
    }),
  });
}

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const locations = (data as LocationTaskData | undefined)?.locations ?? [];
  const latest = locations[0];
  if (!latest) return;
  try {
    await postLocation(latest, 'mobile_background');
  } catch {
    // Background tasks should not surface transient network errors to the OS.
  }
});

export async function requestLocationPermissions() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return { granted: false, background: false };

  const background = await Location.requestBackgroundPermissionsAsync();
  return { granted: true, background: background.status === 'granted' };
}

export async function requestForegroundLocationPermission() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  return { granted: foreground.status === 'granted' };
}

export async function startBackgroundLocationReporting() {
  const permissions = await requestLocationPermissions();
  if (!permissions.granted) return permissions;

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (!alreadyStarted && permissions.background) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: FIVE_MINUTES_MS,
      distanceInterval: 50,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'ASEL Pointage',
        notificationBody: 'Position active pour pointage et tracabilite.',
      },
    });
  }

  return permissions;
}

export async function stopBackgroundLocationReporting() {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
}

export async function sendCurrentLocation(source: 'mobile_foreground' | 'mobile_background' = 'mobile_foreground') {
  const location = await getCurrentLocation();
  await postLocation(location, source);
  return location;
}

async function getCurrentLocation() {
  const permission = await requestForegroundLocationPermission();
  if (!permission.granted) throw new Error('Permission GPS refusee.');
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}

export function locationIntervalMs() {
  return FIVE_MINUTES_MS;
}
