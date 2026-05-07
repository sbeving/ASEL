import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Network from 'expo-network';

export interface DeviceIntegrity {
  platform: string;
  appId: string | null;
  appVersion: string | null;
  buildVersion: string | null;
  deviceName: string | null;
  brand: string | null;
  modelName: string | null;
  osName: string | null;
  osVersion: string | null;
  isDevice: boolean | null;
  networkType: string | null;
  isInternetReachable: boolean | null;
  suspicious: string[];
  blocked: boolean;
}

export type IntegrityLocation = {
  coords: {
    accuracy?: number | null;
    speed?: number | null;
  };
  mocked?: boolean;
};

function locationMocked(location?: IntegrityLocation | null) {
  if (!location) return false;
  const maybeCoords = location.coords as { mocked?: boolean };
  return location.mocked === true || maybeCoords.mocked === true;
}

export async function collectDeviceIntegrity(location?: IntegrityLocation | null): Promise<DeviceIntegrity> {
  const network = await Network.getNetworkStateAsync().catch(() => null);
  const networkType = network?.type == null ? null : String(network.type).toLowerCase();
  const suspicious: string[] = [];
  const accuracy = location?.coords.accuracy;
  const speed = location?.coords.speed;

  if (locationMocked(location)) suspicious.push('mocked_location');
  if (Platform.OS === 'android' && Device.isDevice === false) suspicious.push('android_emulator');
  if (accuracy == null) suspicious.push('missing_accuracy');
  else if (accuracy > 300) suspicious.push('low_accuracy');
  if (typeof speed === 'number' && speed > 55) suspicious.push('unrealistic_speed');
  if (networkType && ['vpn', 'proxy'].some((token) => networkType.includes(token))) {
    suspicious.push('vpn_or_proxy_network');
  }

  return {
    platform: Platform.OS,
    appId: Application.applicationId ?? null,
    appVersion: Application.nativeApplicationVersion ?? null,
    buildVersion: Application.nativeBuildVersion ?? null,
    deviceName: Device.deviceName ?? null,
    brand: Device.brand ?? null,
    modelName: Device.modelName ?? null,
    osName: Device.osName ?? null,
    osVersion: Device.osVersion ?? null,
    isDevice: Device.isDevice ?? null,
    networkType,
    isInternetReachable: network?.isInternetReachable ?? null,
    suspicious,
    blocked: suspicious.includes('mocked_location') || suspicious.includes('android_emulator') || suspicious.includes('low_accuracy'),
  };
}

export function integrityLabel(integrity?: DeviceIntegrity | null) {
  if (!integrity) return 'Verification securite en attente';
  if (integrity.blocked) return 'GPS refuse: controle securite negatif';
  if (integrity.suspicious.length > 0) return 'GPS accepte avec alerte';
  return 'GPS securise';
}
