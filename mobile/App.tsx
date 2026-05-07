import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, { Circle as MapCircle, Marker, Polygon } from 'react-native-maps';
import { apiFetch, loadMe, login, logout } from './src/api';
import {
  locationIntervalMs,
  sendCurrentLocation,
  startBackgroundLocationReporting,
  stopBackgroundLocationReporting,
} from './src/locationReporter';
import { collectDeviceIntegrity, integrityLabel, type DeviceIntegrity } from './src/integrity';
import type { CommercialZone, NetworkPoint, TimeLogType, User } from './src/types';

const pointageLabels: Record<TimeLogType, string> = {
  entree: 'Entree',
  sortie: 'Sortie',
  pause_debut: 'Pause debut',
  pause_fin: 'Pause fin',
};

const pointTypes: NetworkPoint['type'][] = ['activation_recharge', 'activation', 'recharge'];
const pointStatuses: NetworkPoint['status'][] = ['prospect', 'contact', 'contrat_non_signe', 'contrat_signe', 'actif', 'suspendu', 'resilie'];
const createPointStatuses: NetworkPoint['status'][] = ['prospect', 'contact', 'contrat_signe', 'actif'];

type Screen = 'dashboard' | 'pointage' | 'map' | 'points' | 'newPoint';
type PointFilter = 'all' | NetworkPoint['type'];
type StatusFilter = 'all' | NetworkPoint['status'];
type AllocationKind = 'sim' | 'recharge' | 'other';

interface TimeLogRow {
  type: TimeLogType;
  timestamp: string;
}

interface WorkState {
  workedMinutes: number;
  activeShift: boolean;
  paused: boolean;
}

type GpsDraft = {
  lat: number;
  lng: number;
  accuracy?: number | null;
  mocked?: boolean | null;
};

type PointLocationMode = 'current' | 'pin';

type SignaturePoint = {
  x: number;
  y: number;
};

type SignatureTrace = SignaturePoint[][];

type PickedImage = {
  uri: string;
  name: string;
  type: string;
};

interface DashboardData {
  roleStats?: {
    commercial?: {
      networkPoints?: number;
      zones?: number;
      pointsWithGps?: number;
    };
    employee?: {
      workedMinutesThisWeek?: number;
      activeShift?: boolean;
      pendingLeaveRequests?: number;
      siteName?: string;
      lastType?: TimeLogType | null;
      lastTimestamp?: string | null;
    };
    hr?: {
      employeeCount?: number;
      atWorkCount?: number;
      weekHours?: number;
      pendingLeaveRequests?: number;
      outOfZoneCommercialPings?: number;
      byRole?: Array<{ role: string; count: number }>;
      latestPunches?: Array<{
        _id: string;
        type: TimeLogType;
        timestamp: string;
        employeeName: string;
        role: string;
        site: string;
      }>;
    };
  };
  kpis?: {
    productCount?: number;
    franchiseCount?: number;
    todaySalesTotal?: number;
    todaySalesCount?: number;
    monthSalesTotal?: number;
    monthSalesCount?: number;
    lowStockCount?: number;
    pendingTransfers?: number;
  };
  reports?: {
    cashToday?: { in?: number; out?: number; net?: number };
    pendingInstallments?: number;
    topProducts?: Array<{ name?: string; quantity?: number; total?: number; revenue?: number }>;
    paymentBreakdown?: Array<{ _id?: string; total?: number; count?: number }>;
  };
  roleProfile?: {
    primaryGoal?: string;
    recommendedActions?: string[];
  };
}

interface PointageLog {
  _id?: string;
  type: TimeLogType;
  timestamp: string;
  note?: string;
  gps?: {
    accuracy?: number | null;
  };
}

interface DashboardInsight {
  label: string;
  value: string;
  detail?: string;
  tone?: 'green' | 'blue' | 'amber' | 'slate';
}

interface DashboardAction {
  label: string;
  screen: Screen;
}

interface DashboardPlan {
  eyebrow: string;
  title: string;
  copy: string;
  insights: DashboardInsight[];
  actions: DashboardAction[];
  highlights: Array<{ label: string; value: string }>;
  rows: Array<{ label: string; value: string }>;
  activity: Array<{ title: string; detail: string; tone?: 'green' | 'blue' | 'amber' | 'slate' }>;
}

interface NotificationRow {
  _id: string;
  title: string;
  message?: string;
  type?: 'info' | 'warning' | 'danger' | 'success';
  readAt?: string | null;
  createdAt?: string;
}

interface LeaveRequestRow {
  _id: string;
  type: string;
  fromDate: string;
  toDate: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewNote?: string;
}

interface ProductLite {
  _id: string;
  name: string;
  reference?: string;
  barcode?: string;
  currentStock?: number;
}

interface AllocationRow {
  _id: string;
  kind: AllocationKind;
  quantity: number;
  amount: number;
  barcodes?: string[];
  barcodeCount?: number;
  note?: string;
  createdAt?: string;
  productId?: ProductLite | null;
}

interface AllocationSummary {
  quantity: number;
  amount: number;
  barcodeCount: number;
  byKind: Record<string, { quantity: number; amount: number; barcodeCount: number }>;
}

interface PointOverview {
  point: NetworkPoint;
  allocations: AllocationRow[];
  monthly: AllocationSummary;
  totals: AllocationSummary;
}

function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${String(rest).padStart(2, '0')}` : `${hours}h`;
}

function formatMoney(value?: number | null) {
  return `${Math.round(value ?? 0).toLocaleString('fr-FR')} TND`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function distanceMeters(a?: { lat?: number | null; lng?: number | null } | null, b?: { lat?: number | null; lng?: number | null } | null) {
  if (typeof a?.lat !== 'number' || typeof a.lng !== 'number' || typeof b?.lat !== 'number' || typeof b.lng !== 'number') return null;
  const radius = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatDistance(meters?: number | null) {
  if (meters == null) return 'Distance inconnue';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function notificationTone(type?: NotificationRow['type']) {
  if (type === 'danger') return '#dc2626';
  if (type === 'warning') return '#d97706';
  if (type === 'success') return '#16a34a';
  return '#0369a1';
}

function splitBarcodes(value: string) {
  return [...new Set(value.split(/[\s,;]+/).map((barcode) => barcode.trim()).filter(Boolean))];
}

function isObjectId(id?: string) {
  return Boolean(id && /^[a-f\d]{24}$/i.test(id));
}

function computeWorkState(logs: TimeLogRow[]): WorkState {
  const sorted = [...logs].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  let start: number | null = null;
  let pauseStart: number | null = null;
  let pausedMs = 0;
  let totalMs = 0;

  for (const log of sorted) {
    const at = new Date(log.timestamp).getTime();
    if (!Number.isFinite(at)) continue;
    if (log.type === 'entree') {
      start = at;
      pauseStart = null;
      pausedMs = 0;
    } else if (log.type === 'pause_debut' && start !== null && pauseStart === null) {
      pauseStart = at;
    } else if (log.type === 'pause_fin' && pauseStart !== null) {
      pausedMs += Math.max(0, at - pauseStart);
      pauseStart = null;
    } else if (log.type === 'sortie' && start !== null) {
      totalMs += Math.max(0, at - start - pausedMs);
      start = null;
      pauseStart = null;
      pausedMs = 0;
    }
  }

  const activeShift = start !== null && Date.now() - start < 18 * 60 * 60 * 1000;
  if (activeShift && start !== null) {
    const livePaused = pauseStart !== null ? Date.now() - pauseStart : 0;
    totalMs += Math.max(0, Date.now() - start - pausedMs - livePaused);
  }

  return {
    workedMinutes: Math.round(totalMs / 60000),
    activeShift,
    paused: activeShift && pauseStart !== null,
  };
}

function gpsFromLocation(location: { coords: { latitude: number; longitude: number; accuracy?: number | null }; timestamp: number }) {
  const mocked =
    (location as { mocked?: boolean }).mocked ??
    (location.coords as { mocked?: boolean }).mocked ??
    null;
  return {
    lat: Number(location.coords.latitude.toFixed(6)),
    lng: Number(location.coords.longitude.toFixed(6)),
    accuracy: location.coords.accuracy == null ? null : Math.round(location.coords.accuracy),
    capturedAt: new Date(location.timestamp).toISOString(),
    mocked,
  };
}

async function getForegroundLocation() {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Permission GPS refusee.');
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
}

function gpsAccuracyColor(accuracy?: number | null) {
  if (accuracy == null) return '#64748b';
  if (accuracy <= 30) return '#10b981';
  if (accuracy <= 100) return '#f59e0b';
  return '#ef4444';
}

function imageNameFromUri(uri: string, fallback: string) {
  const raw = uri.split('/').pop()?.split('?')[0] || fallback;
  return raw.includes('.') ? raw : `${raw}.jpg`;
}

function imageMimeFromUri(uri: string) {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function pointTypeLabel(type: NetworkPoint['type']) {
  if (type === 'activation') return 'Activation';
  if (type === 'recharge') return 'Recharge';
  if (type === 'franchise') return 'Franchise';
  return 'Activation + Recharge';
}

function pointTypeColor(type: NetworkPoint['type']) {
  if (type === 'activation') return '#10b981';
  if (type === 'recharge') return '#f59e0b';
  if (type === 'franchise') return '#0284c7';
  return '#7c3aed';
}

function pointInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? 'P';
  const second = parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1];
  return `${first}${second ?? ''}`.toUpperCase();
}

function screenLabel(screen: Screen) {
  if (screen === 'dashboard') return 'Board';
  if (screen === 'pointage') return 'Pointage';
  if (screen === 'map') return 'Carte';
  if (screen === 'points') return 'Reseau';
  return 'Ajouter point';
}

function gpsQualityLabel(accuracy?: number | null) {
  if (accuracy == null) return 'GPS a verifier';
  if (accuracy <= 30) return `GPS precis · ${accuracy} m`;
  if (accuracy <= 100) return `GPS moyen · ${accuracy} m`;
  return `GPS faible · ${accuracy} m`;
}

function openDirections(point: NetworkPoint) {
  const lat = point.gps?.lat;
  const lng = point.gps?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    Alert.alert('GPS indisponible', 'Ce point n a pas de position GPS.');
    return;
  }
  const url =
    Platform.OS === 'ios'
      ? `http://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`
      : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(point.name)})`;
  Linking.openURL(url).catch(() => Alert.alert('Carte indisponible', 'Impossible d ouvrir l application de navigation.'));
}

function openPhone(phone?: string) {
  if (!phone) {
    Alert.alert('Telephone indisponible', 'Aucun numero pour ce point.');
    return;
  }
  Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Appel indisponible', 'Impossible d ouvrir le telephone.'));
}

function openMail(email?: string) {
  if (!email) {
    Alert.alert('Email indisponible', 'Aucun email pour ce point.');
    return;
  }
  Linking.openURL(`mailto:${email}`).catch(() => Alert.alert('Email indisponible', 'Impossible d ouvrir la messagerie.'));
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
  const [timeLogs, setTimeLogs] = useState<PointageLog[]>([]);
  const [workedMinutes, setWorkedMinutes] = useState(0);
  const [activeShift, setActiveShift] = useState(false);
  const [pausedShift, setPausedShift] = useState(false);
  const [leaveFromDate, setLeaveFromDate] = useState(monthKey() + '-01');
  const [leaveToDate, setLeaveToDate] = useState(monthKey() + '-01');
  const [leaveReason, setLeaveReason] = useState('');
  const [lastGps, setLastGps] = useState<{ lat: number; lng: number; accuracy: number | null; capturedAt: string; mocked: boolean | null } | null>(null);
  const [integrity, setIntegrity] = useState<DeviceIntegrity | null>(null);
  const [locationConfirmed, setLocationConfirmed] = useState(false);
  const [points, setPoints] = useState<NetworkPoint[]>([]);
  const [zones, setZones] = useState<CommercialZone[]>([]);
  const [selectedPointId, setSelectedPointId] = useState('');
  const [pointSearch, setPointSearch] = useState('');
  const [pointTypeFilter, setPointTypeFilter] = useState<PointFilter>('all');
  const [pointStatusFilter, setPointStatusFilter] = useState<StatusFilter>('all');
  const [pointOverview, setPointOverview] = useState<PointOverview | null>(null);
  const [pointOverviewBusy, setPointOverviewBusy] = useState(false);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [allocationDraft, setAllocationDraft] = useState({
    kind: 'recharge' as AllocationKind,
    productId: '',
    amount: '',
    barcodes: '',
    note: '',
  });
  const [newPoint, setNewPoint] = useState({
    name: '',
    type: 'activation_recharge' as NetworkPoint['type'],
    status: 'prospect' as NetworkPoint['status'],
    address: '',
    city: '',
    governorate: '',
    responsibleFirstName: '',
    responsibleLastName: '',
    responsible: '',
    phone: '',
    phone2: '',
    email: '',
    cin: '',
    note: '',
  });
  const [pointLocationMode, setPointLocationMode] = useState<PointLocationMode>('current');
  const [pointPin, setPointPin] = useState<GpsDraft | null>(null);
  const [cinImage, setCinImage] = useState<PickedImage | null>(null);
  const [shopImage, setShopImage] = useState<PickedImage | null>(null);
  const [signatureTrace, setSignatureTrace] = useState<SignatureTrace>([]);

  const allowed = user?.role === 'siege_employee' || user?.role === 'hr_admin' || user?.role === 'commercial';
  const isCommercial = user?.role === 'commercial';
  const gpsRejected = integrity?.blocked === true;
  const canUseConfirmedGps = Boolean(lastGps && locationConfirmed && !gpsRejected);
  const pointGps: GpsDraft | null =
    pointLocationMode === 'pin'
      ? pointPin
      : lastGps
        ? { lat: lastGps.lat, lng: lastGps.lng, accuracy: lastGps.accuracy, mocked: lastGps.mocked }
        : null;

  const mapRegion = useMemo(() => {
    const gpsPoint = lastGps ?? points.find((point) => point.gps?.lat && point.gps?.lng)?.gps;
    return {
      latitude: Number(gpsPoint?.lat ?? 36.8065),
      longitude: Number(gpsPoint?.lng ?? 10.1815),
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }, [lastGps, points]);
  const selectedPoint = useMemo(
    () => points.find((point) => point._id === selectedPointId) ?? null,
    [points, selectedPointId],
  );
  const filteredPoints = useMemo(() => {
    const needle = pointSearch.trim().toLowerCase();
    return points
      .filter((point) => pointTypeFilter === 'all' || point.type === pointTypeFilter)
      .filter((point) => pointStatusFilter === 'all' || point.status === pointStatusFilter)
      .filter((point) => {
        if (!needle) return true;
        return [point.name, point.responsible, point.phone, point.phone2, point.email, point.cin, point.city, point.address]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .sort((left, right) => {
        const current = lastGps ? { lat: lastGps.lat, lng: lastGps.lng } : null;
        const dl = distanceMeters(current, left.gps);
        const dr = distanceMeters(current, right.gps);
        if (dl == null && dr == null) return left.name.localeCompare(right.name);
        if (dl == null) return 1;
        if (dr == null) return -1;
        return dl - dr;
      });
  }, [lastGps, pointSearch, pointStatusFilter, pointTypeFilter, points]);
  const duplicateCandidates = useMemo(() => {
    const name = newPoint.name.trim().toLowerCase();
    const phone = newPoint.phone.trim();
    const cin = newPoint.cin.trim();
    if (!name && !phone && !cin) return [];
    return points.filter((point) => {
      const sameName = name && point.name.toLowerCase().includes(name);
      const samePhone = phone && [point.phone, point.phone2].filter(Boolean).includes(phone);
      const sameCin = cin && point.cin === cin;
      return sameName || samePhone || sameCin;
    }).slice(0, 3);
  }, [newPoint.cin, newPoint.name, newPoint.phone, points]);
  const mapCounters = useMemo(
    () => ({
      zones: zones.length,
      points: filteredPoints.length,
      activation: filteredPoints.filter((point) => point.type === 'activation' || point.type === 'activation_recharge').length,
      recharge: filteredPoints.filter((point) => point.type === 'recharge' || point.type === 'activation_recharge').length,
    }),
    [filteredPoints, zones],
  );
  const navigationTabs = useMemo(() => {
    if (isCommercial) {
      return [
        ['dashboard', 'Board'],
        ['pointage', 'Pointage'],
        ['map', 'Carte'],
        ['points', 'Reseau'],
        ['newPoint', 'Ajouter'],
      ] as Array<[Screen, string]>;
    }
    return [
      ['dashboard', 'Board'],
      ['pointage', 'Pointage'],
    ] as Array<[Screen, string]>;
  }, [isCommercial]);
  const currentScreenLabel = screenLabel(screen);
  const shiftLabel = activeShift ? (pausedShift ? 'Pause active' : 'Travail actif') : 'Hors travail';
  const syncLabel = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Jamais';
  const commercialStats = dashboard?.roleStats?.commercial;
  const employeeStats = dashboard?.roleStats?.employee;
  const hrStats = dashboard?.roleStats?.hr;
  const selectedDistance = distanceMeters(lastGps ? { lat: lastGps.lat, lng: lastGps.lng } : null, selectedPoint?.gps);
  const todayLogCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return timeLogs.filter((log) => log.timestamp?.slice(0, 10) === today).length;
  }, [timeLogs]);
  const commercialPipeline = useMemo(() => {
    const total = points.length;
    const signed = points.filter((point) => point.status === 'contrat_signe' || point.status === 'actif').length;
    const prospects = points.filter((point) => point.status === 'prospect' || point.status === 'contact').length;
    const mapped = points.filter((point) => point.gps?.lat && point.gps?.lng).length;
    return {
      total,
      signed,
      prospects,
      mapped,
      signedRate: total > 0 ? Math.round((signed / total) * 100) : 0,
      mappedRate: total > 0 ? Math.round((mapped / total) * 100) : 0,
    };
  }, [points]);
  const nearestPoints = useMemo(
    () => filteredPoints.filter((point) => point.gps?.lat && point.gps?.lng).slice(0, 4),
    [filteredPoints],
  );
  const dashboardPlan = useMemo<DashboardPlan>(() => {
    if (isCommercial) {
      return {
        eyebrow: 'Commercial terrain',
        title: activeShift ? (pausedShift ? 'Pause en cours' : 'Tournee active') : 'Tournee prete',
        copy: activeShift
          ? 'Suivi GPS actif, reseau synchronise et actions point disponibles.'
          : 'Demarrez entree pour activer le suivi commercial automatique.',
        insights: [
          { label: 'Points reseau', value: String(commercialStats?.networkPoints ?? commercialPipeline.total), detail: `${commercialPipeline.signedRate}% signes`, tone: 'green' },
          { label: 'Zones', value: String(commercialStats?.zones ?? zones.length), detail: zones.map((zone) => zone.name).slice(0, 2).join(', ') || 'Non assigne', tone: zones.length ? 'blue' : 'amber' },
          { label: 'Couverture GPS', value: `${commercialPipeline.mappedRate}%`, detail: `${commercialStats?.pointsWithGps ?? commercialPipeline.mapped}/${commercialPipeline.total} points`, tone: commercialPipeline.mappedRate >= 80 ? 'green' : 'amber' },
          { label: 'Prospects', value: String(commercialPipeline.prospects), detail: `${commercialPipeline.signed} actifs/signes`, tone: 'slate' },
        ],
        actions: [
          { label: 'Carte zone', screen: 'map' },
          { label: 'Ajouter point', screen: 'newPoint' },
          { label: 'Reseau', screen: 'points' },
          { label: 'Pointage', screen: 'pointage' },
        ],
        highlights: [
          { label: 'Derniere synchro', value: formatDateTime(lastSyncedAt) },
          { label: 'GPS', value: lastGps?.accuracy != null ? `${lastGps.accuracy} m` : 'A verifier' },
          { label: 'Tracking', value: activeShift ? 'Actif' : 'Inactif' },
        ],
        rows: [
          { label: 'Activation', value: String(points.filter((point) => point.type === 'activation' || point.type === 'activation_recharge').length) },
          { label: 'Recharge', value: String(points.filter((point) => point.type === 'recharge' || point.type === 'activation_recharge').length) },
          { label: 'Points sans GPS', value: String(Math.max(0, commercialPipeline.total - commercialPipeline.mapped)) },
          { label: 'Conges en attente', value: String(leaveRequests.filter((item) => item.status === 'pending').length) },
        ],
        activity: nearestPoints.map((point) => ({
          title: point.name,
          detail: `${pointTypeLabel(point.type)} · ${formatDistance(distanceMeters(lastGps ? { lat: lastGps.lat, lng: lastGps.lng } : null, point.gps))}`,
          tone: point.status === 'actif' || point.status === 'contrat_signe' ? 'green' : 'slate',
        })),
      };
    }

    if (user?.role === 'hr_admin') {
      return {
        eyebrow: 'Pilotage RH mobile',
        title: `${hrStats?.atWorkCount ?? 0}/${hrStats?.employeeCount ?? 0} en travail`,
        copy: 'Suivi pointage siege, commerciaux et demandes conge sur le meme tableau.',
        insights: [
          { label: 'Employes', value: String(hrStats?.employeeCount ?? 0), detail: 'Siege + franchises + commerciaux', tone: 'blue' },
          { label: 'En travail', value: String(hrStats?.atWorkCount ?? 0), detail: `${hrStats?.weekHours ?? 0} h semaine`, tone: 'green' },
          { label: 'Conges', value: String(hrStats?.pendingLeaveRequests ?? 0), detail: 'Demandes a traiter', tone: (hrStats?.pendingLeaveRequests ?? 0) > 0 ? 'amber' : 'green' },
          { label: 'Hors zone', value: String(hrStats?.outOfZoneCommercialPings ?? 0), detail: 'Pings commerciaux', tone: (hrStats?.outOfZoneCommercialPings ?? 0) > 0 ? 'amber' : 'slate' },
        ],
        actions: [
          { label: 'Pointage', screen: 'pointage' },
          { label: 'Dashboard', screen: 'dashboard' },
        ],
        highlights: [
          { label: 'Derniere synchro', value: formatDateTime(lastSyncedAt) },
          { label: 'Mon GPS', value: lastGps?.accuracy != null ? `${lastGps.accuracy} m` : 'A verifier' },
          { label: 'Notifications', value: String(unreadCount) },
        ],
        rows: (hrStats?.byRole ?? []).map((row) => ({ label: statusLabel(row.role), value: String(row.count) })),
        activity: (hrStats?.latestPunches ?? []).slice(0, 5).map((log) => ({
          title: `${log.employeeName || 'Employe'} · ${pointageLabels[log.type]}`,
          detail: `${formatDateTime(log.timestamp)} · ${log.site || log.role}`,
          tone: log.type === 'entree' || log.type === 'pause_fin' ? 'green' : 'slate',
        })),
      };
    }

    return {
      eyebrow: 'Employe siege',
      title: employeeStats?.activeShift || activeShift ? 'Presence active' : 'Pointage siege',
      copy: `Pointage autorise autour de ${employeeStats?.siteName ?? 'ASEL Siege'} avec verification GPS.`,
      insights: [
        { label: 'Heures semaine', value: formatHours(employeeStats?.workedMinutesThisWeek ?? workedMinutes), detail: `${formatHours(workedMinutes)} ce mois`, tone: 'green' },
        { label: 'Aujourd hui', value: String(todayLogCount), detail: 'Mouvements pointage', tone: todayLogCount >= 2 ? 'blue' : 'slate' },
        { label: 'Conges', value: String(employeeStats?.pendingLeaveRequests ?? leaveRequests.filter((item) => item.status === 'pending').length), detail: 'Demandes en attente', tone: 'amber' },
        { label: 'GPS', value: lastGps?.accuracy != null ? `${lastGps.accuracy} m` : 'A verifier', detail: integrityLabel(integrity), tone: gpsRejected ? 'amber' : 'green' },
      ],
      actions: [
        { label: 'Pointer', screen: 'pointage' },
        { label: 'Verifier GPS', screen: 'pointage' },
      ],
      highlights: [
        { label: 'Dernier pointage', value: employeeStats?.lastType ? `${pointageLabels[employeeStats.lastType]} · ${formatDateTime(employeeStats.lastTimestamp)}` : 'Aucun' },
        { label: 'Derniere synchro', value: formatDateTime(lastSyncedAt) },
        { label: 'Notifications', value: String(unreadCount) },
      ],
      rows: leaveRequests.slice(0, 4).map((item) => ({ label: `${item.fromDate} au ${item.toDate}`, value: statusLabel(item.status) })),
      activity: timeLogs.slice(-5).reverse().map((log) => ({
        title: pointageLabels[log.type],
        detail: `${formatDateTime(log.timestamp)}${log.gps?.accuracy != null ? ` · ${log.gps.accuracy} m` : ''}`,
        tone: log.type === 'entree' || log.type === 'pause_fin' ? 'green' : 'slate',
      })),
    };
  }, [
    activeShift,
    commercialPipeline,
    commercialStats,
    employeeStats,
    filteredPoints,
    gpsRejected,
    hrStats,
    integrity,
    isCommercial,
    lastGps,
    lastSyncedAt,
    leaveRequests,
    nearestPoints,
    pausedShift,
    points,
    timeLogs,
    todayLogCount,
    unreadCount,
    user?.role,
    workedMinutes,
    zones,
  ]);

  async function refreshWorkedHours() {
    const data = await apiFetch<{ logs: PointageLog[] }>(`/timelogs?scope=self&month=${monthKey()}&pageSize=500`);
    setTimeLogs(data.logs ?? []);
    const state = computeWorkState(data.logs ?? []);
    setWorkedMinutes(state.workedMinutes);
    setActiveShift(state.activeShift);
    setPausedShift(state.paused);
    return state;
  }

  async function refreshNetwork() {
    if (!isCommercial) return;
    const data = await apiFetch<{ points: NetworkPoint[]; zones: CommercialZone[] }>('/network-points/map?fallbackFranchises=true');
    setPoints(data.points ?? []);
    setZones(data.zones ?? []);
  }

  async function refreshDashboard() {
    const data = await apiFetch<DashboardData>('/dashboard');
    setDashboard(data);
  }

  async function refreshNotifications() {
    const data = await apiFetch<{ notifications: NotificationRow[]; unreadCount: number }>('/notifications?pageSize=6');
    setNotifications(data.notifications ?? []);
    setUnreadCount(data.unreadCount ?? 0);
  }

  async function refreshLeaveHistory() {
    const data = await apiFetch<{ leaveRequests: LeaveRequestRow[] }>('/leave-requests?scope=self&pageSize=5');
    setLeaveRequests(data.leaveRequests ?? []);
  }

  async function refreshProducts() {
    if (!isCommercial) return;
    const data = await apiFetch<{ products: ProductLite[] }>('/products?active=true&pageSize=200');
    setProducts(data.products ?? []);
  }

  async function refreshMobileData() {
    await Promise.all([
      refreshDashboard().catch(() => undefined),
      refreshWorkedHours().catch(() => undefined),
      refreshNotifications().catch(() => undefined),
      refreshLeaveHistory().catch(() => undefined),
      refreshNetwork().catch(() => undefined),
      refreshProducts().catch(() => undefined),
    ]);
    setLastSyncedAt(new Date().toISOString());
  }

  async function pullToRefresh() {
    setRefreshing(true);
    try {
      await refreshMobileData();
      if (selectedPointId) await refreshPointOverview(selectedPointId).catch(() => undefined);
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshPointOverview(pointId: string) {
    if (!isObjectId(pointId)) {
      setPointOverview(null);
      return;
    }
    setPointOverviewBusy(true);
    try {
      const data = await apiFetch<PointOverview>(`/network-points/${pointId}/overview`);
      setPointOverview(data);
    } finally {
      setPointOverviewBusy(false);
    }
  }

  async function selectPoint(pointId: string, nextScreen?: Screen) {
    setSelectedPointId(pointId);
    if (nextScreen) setScreen(nextScreen);
    await refreshPointOverview(pointId).catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Details point indisponibles');
    });
  }

  async function captureGps(postPing: boolean) {
    const location = postPing ? await sendCurrentLocation('mobile_foreground') : await getForegroundLocation();
    const nextIntegrity = await collectDeviceIntegrity(location);
    setLastGps(gpsFromLocation(location));
    setIntegrity(nextIntegrity);
    setLocationConfirmed(false);
    return location;
  }

  function assertLocationSafe() {
    if (!lastGps) throw new Error('Verifiez votre position GPS avant de continuer.');
    if (!integrity) throw new Error('Controle securite GPS en attente.');
    if (integrity.blocked) {
      throw new Error(`GPS refuse: ${integrity.suspicious.join(', ') || 'controle securite negatif'}.`);
    }
  }

  async function enableCommercialTracking() {
    if (!isCommercial || !activeShift) return;
    const permissions = await startBackgroundLocationReporting();
    if (!permissions.granted) {
      setMessage('Permission GPS refusee.');
      return;
    }
    await captureGps(true);
  }

  async function verifyGps() {
    setBusy(true);
    setMessage('');
    try {
      await captureGps(false);
      setMessage('Position GPS capturee. Verifiez puis confirmez avant de pointer.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'GPS indisponible');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadMe()
      .then((me) => {
        setUser(me);
        if (me?.role === 'commercial') setScreen('map');
      })
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user || !allowed) return undefined;
    captureGps(false).catch((error) => setMessage(error instanceof Error ? error.message : 'Erreur GPS'));
    refreshMobileData().catch(() => undefined);
    if (!isCommercial) stopBackgroundLocationReporting().catch(() => undefined);
    return undefined;
  }, [allowed, user?.id, isCommercial]);

  useEffect(() => {
    if (!user || !isCommercial || !activeShift) {
      if (user && (!isCommercial || !activeShift)) stopBackgroundLocationReporting().catch(() => undefined);
      return undefined;
    }
    enableCommercialTracking().catch((error) => setMessage(error instanceof Error ? error.message : 'Erreur GPS'));
    const timer = setInterval(() => {
      sendCurrentLocation('mobile_foreground')
        .then(async (location) => {
          setLastGps(gpsFromLocation(location));
          setIntegrity(await collectDeviceIntegrity(location));
          setLocationConfirmed(false);
        })
        .catch(() => undefined);
    }, locationIntervalMs());
    return () => clearInterval(timer);
  }, [activeShift, isCommercial, user?.id]);

  async function submitLogin() {
    setBusy(true);
    setMessage('');
    try {
      const nextUser = await login(username.trim(), password);
      setUser(nextUser);
      setScreen(nextUser.role === 'commercial' ? 'map' : 'dashboard');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Connexion impossible');
    } finally {
      setBusy(false);
    }
  }

  async function punch(type: TimeLogType) {
    setBusy(true);
    setMessage('');
    try {
      if (!lastGps) throw new Error('Verifiez votre position GPS avant le pointage.');
      if (!locationConfirmed) throw new Error('Confirmez la position affichee avant le pointage.');
      assertLocationSafe();
      await apiFetch('/timelogs', {
        method: 'POST',
        body: JSON.stringify({
          type,
          note: note || undefined,
          gps: {
            lat: lastGps.lat,
            lng: lastGps.lng,
            accuracy: lastGps.accuracy,
            mocked: lastGps.mocked,
          },
          integrity,
        }),
      });
      setNote('');
      setLocationConfirmed(false);
      const state = await refreshWorkedHours();
      await refreshDashboard().catch(() => undefined);
      if (isCommercial && type === 'entree') {
        await startBackgroundLocationReporting().catch(() => undefined);
        await sendCurrentLocation('mobile_foreground').catch(() => undefined);
      }
      if (isCommercial && type === 'sortie') {
        await stopBackgroundLocationReporting().catch(() => undefined);
      }
      setMessage(`Pointage enregistre: ${pointageLabels[type]}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pointage impossible');
    } finally {
      setBusy(false);
    }
  }

  async function requestLeave() {
    setBusy(true);
    setMessage('');
    try {
      await apiFetch('/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
          type: 'conge_annuel',
          fromDate: leaveFromDate,
          toDate: leaveToDate,
          reason: leaveReason || undefined,
        }),
      });
      setLeaveReason('');
      await Promise.all([refreshLeaveHistory(), refreshDashboard(), refreshNotifications()].map((task) => task.catch(() => undefined)));
      setMessage('Demande conge envoyee.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Demande impossible');
    } finally {
      setBusy(false);
    }
  }

  async function markNotificationsRead() {
    setBusy(true);
    setMessage('');
    try {
      await apiFetch('/notifications/read-all', { method: 'POST' });
      await refreshNotifications();
      setLastSyncedAt(new Date().toISOString());
      setMessage('Notifications marquees comme lues.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Notifications indisponibles');
    } finally {
      setBusy(false);
    }
  }

  async function pickPointImage(kind: 'cin' | 'shop', source: 'camera' | 'library') {
    setMessage('');
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error(source === 'camera' ? 'Permission camera refusee.' : 'Permission galerie refusee.');
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.72 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.72 });
      if (result.canceled || !result.assets[0]?.uri) return;
      const asset = result.assets[0];
      const picked = {
        uri: asset.uri,
        name: asset.fileName || imageNameFromUri(asset.uri, kind === 'cin' ? 'cin.jpg' : 'boutique.jpg'),
        type: asset.mimeType || imageMimeFromUri(asset.uri),
      };
      if (kind === 'cin') setCinImage(picked);
      else setShopImage(picked);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Image indisponible');
    }
  }

  function resetPointForm() {
    setNewPoint({
      name: '',
      type: 'activation_recharge',
      status: 'prospect',
      address: '',
      city: '',
      governorate: '',
      responsibleFirstName: '',
      responsibleLastName: '',
      responsible: '',
      phone: '',
      phone2: '',
      email: '',
      cin: '',
      note: '',
    });
    setPointLocationMode('current');
    setPointPin(null);
    setCinImage(null);
    setShopImage(null);
    setSignatureTrace([]);
  }

  function appendImage(formData: FormData, field: string, image: PickedImage | null) {
    if (!image) return;
    (formData as any).append(field, {
      uri: image.uri,
      name: image.name,
      type: image.type,
    });
  }

  async function createNetworkPoint() {
    if (!newPoint.name.trim()) {
      Alert.alert('Nom requis', 'Ajoutez le nom du point.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      if (!pointGps) throw new Error('Choisissez une position: GPS actuel ou point sur la carte.');
      if (pointLocationMode === 'current' && !locationConfirmed) {
        throw new Error('Confirmez la position affichee avant de creer le point.');
      }
      if (signatureTrace.length === 0) throw new Error('Signature du responsable requise.');
      assertLocationSafe();
      const responsible =
        newPoint.responsible.trim() ||
        [newPoint.responsibleFirstName.trim(), newPoint.responsibleLastName.trim()].filter(Boolean).join(' ');
      const created = await apiFetch<{ point: NetworkPoint }>('/network-points', {
        method: 'POST',
        body: JSON.stringify({
          name: newPoint.name.trim(),
          type: newPoint.type,
          status: newPoint.status,
          address: newPoint.address,
          city: newPoint.city,
          governorate: newPoint.governorate,
          responsible,
          responsibleFirstName: newPoint.responsibleFirstName,
          responsibleLastName: newPoint.responsibleLastName,
          phone: newPoint.phone,
          phone2: newPoint.phone2,
          email: newPoint.email,
          cin: newPoint.cin,
          internalNotes: newPoint.note,
          gps: {
            lat: pointGps.lat,
            lng: pointGps.lng,
            accuracy: pointGps.accuracy ?? null,
            mocked: pointGps.mocked ?? null,
          },
          integrity,
        }),
      });
      const formData = new FormData();
      formData.append('responsible', responsible || newPoint.name.trim());
      formData.append('responsibleFirstName', newPoint.responsibleFirstName);
      formData.append('responsibleLastName', newPoint.responsibleLastName);
      formData.append('cin', newPoint.cin);
      formData.append('signatureText', responsible || newPoint.name.trim());
      formData.append('signatureTrace', JSON.stringify(signatureTrace));
      appendImage(formData, 'cinImage', cinImage);
      appendImage(formData, 'shopImage', shopImage);
      await apiFetch(`/network-points/${created.point._id}/documents`, {
        method: 'POST',
        body: formData,
      });
      resetPointForm();
      setLocationConfirmed(false);
      await Promise.all([refreshNetwork(), refreshDashboard()].map((task) => task.catch(() => undefined)));
      await selectPoint(created.point._id, 'points');
      setMessage('Point reseau ajoute avec fiche signee.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Creation impossible');
    } finally {
      setBusy(false);
    }
  }

  async function createAllocation() {
    if (!selectedPoint || !isObjectId(selectedPoint._id)) return;
    setBusy(true);
    setMessage('');
    try {
      const barcodes = splitBarcodes(allocationDraft.barcodes);
      const amount = Number(allocationDraft.amount || 0);
      if (allocationDraft.kind === 'sim' && (!allocationDraft.productId || barcodes.length === 0)) {
        throw new Error('Choisissez le produit SIM et scannez au moins un code-barres.');
      }
      if (allocationDraft.kind !== 'sim' && amount <= 0) throw new Error('Ajoutez le montant solde.');
      const body = allocationDraft.kind === 'sim'
        ? {
            kind: allocationDraft.kind,
            productId: allocationDraft.productId,
            barcodes,
            note: allocationDraft.note || undefined,
          }
        : {
            kind: allocationDraft.kind,
            amount,
            quantity: 0,
            note: allocationDraft.note || undefined,
          };
      await apiFetch(`/network-points/${selectedPoint._id}/allocations`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setAllocationDraft({ kind: 'recharge', productId: '', amount: '', barcodes: '', note: '' });
      await refreshPointOverview(selectedPoint._id);
      setMessage('Dotation enregistree.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Dotation impossible');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await stopBackgroundLocationReporting().catch(() => undefined);
    await logout();
    setUser(null);
    setPassword('');
    setMessage('');
    setLastGps(null);
    setIntegrity(null);
    setLocationConfirmed(false);
  }

  if (booting) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0f172a" />
      </View>
    );
  }

  if (!user) {
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <View style={styles.loginPanel}>
          <Text style={styles.brand}>ASEL Pointage</Text>
          <Text style={styles.muted}>Application mobile employes siege et commerciaux</Text>
          <TextInput style={styles.input} placeholder="Utilisateur" autoCapitalize="none" value={username} onChangeText={setUsername} />
          <TextInput style={styles.input} placeholder="Mot de passe" secureTextEntry value={password} onChangeText={setPassword} />
          <Pressable style={styles.primaryButton} disabled={busy} onPress={submitLogin}>
            <Text style={styles.primaryButtonText}>{busy ? 'Connexion...' : 'Se connecter'}</Text>
          </Pressable>
          {message ? <Text style={styles.error}>{message}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    );
  }

  if (!allowed) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.brand}>ASEL Pointage</Text>
          <Pressable onPress={signOut}><Text style={styles.link}>Sortir</Text></Pressable>
        </View>
        <Text style={styles.error}>Cette application est reservee au siege et aux commerciaux.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>ASEL Pointage</Text>
          <Text style={styles.muted}>{user.fullName} · {user.role}</Text>
        </View>
        <Pressable onPress={signOut}><Text style={styles.link}>Sortir</Text></Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabs}>
        {navigationTabs.map(([item, label]) => (
            <Pressable key={item} style={[styles.tab, screen === item && styles.tabActive]} onPress={() => setScreen(item)}>
              <Text style={[styles.tabText, screen === item && styles.tabTextActive]}>{label}</Text>
              {item === 'dashboard' && unreadCount > 0 ? <Text style={styles.tabMeta}>{unreadCount} alertes</Text> : null}
              {item === 'points' && isCommercial ? <Text style={styles.tabMeta}>{points.length} points</Text> : null}
              {item === 'map' && isCommercial ? <Text style={styles.tabMeta}>{zones.length} zones</Text> : null}
            </Pressable>
        ))}
      </ScrollView>

      <View style={styles.statusRail}>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipLabel}>Ecran</Text>
          <Text style={styles.statusChipValue}>{currentScreenLabel}</Text>
        </View>
        <View style={[styles.statusChip, activeShift ? styles.statusChipGreen : styles.statusChipSlate]}>
          <Text style={styles.statusChipLabel}>Presence</Text>
          <Text style={styles.statusChipValue}>{shiftLabel}</Text>
        </View>
        <View style={[styles.statusChip, { borderColor: gpsAccuracyColor(lastGps?.accuracy) }]}>
          <Text style={styles.statusChipLabel}>GPS</Text>
          <Text style={[styles.statusChipValue, { color: gpsAccuracyColor(lastGps?.accuracy) }]}>
            {gpsQualityLabel(lastGps?.accuracy)}
          </Text>
        </View>
        <Pressable style={styles.statusChipButton} disabled={refreshing || busy} onPress={pullToRefresh}>
          <Text style={styles.statusChipLabel}>Sync</Text>
          <Text style={styles.statusChipValue}>{refreshing ? '...' : syncLabel}</Text>
        </Pressable>
      </View>

      {message ? <Text style={styles.notice}>{message}</Text> : null}

      {screen === 'dashboard' && (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
        >
          <View style={styles.heroPanel}>
            <View style={styles.heroTop}>
              <View style={styles.heroText}>
                <Text style={styles.heroEyebrow}>{dashboardPlan.eyebrow}</Text>
                <Text style={styles.heroTitle}>{dashboardPlan.title}</Text>
              </View>
              <View style={[styles.liveBadge, activeShift ? styles.liveBadgeOn : styles.liveBadgeOff]}>
                <Text style={[styles.liveBadgeText, activeShift ? styles.liveBadgeTextOn : styles.liveBadgeTextOff]}>
                  {activeShift ? 'ON' : 'OFF'}
                </Text>
              </View>
            </View>
            <Text style={styles.heroCopy}>{dashboardPlan.copy}</Text>
          </View>

          <View style={styles.kpiGrid}>
            {dashboardPlan.insights.map((item) => (
              <MiniKpi key={item.label} label={item.label} value={item.value} detail={item.detail} tone={item.tone} />
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Menu rapide</Text>
              <Text style={styles.syncText}>Sync {formatDateTime(lastSyncedAt)}</Text>
            </View>
            <View style={styles.actionGrid}>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={verifyGps}>
                <Text style={styles.secondaryButtonText}>Verifier GPS</Text>
              </Pressable>
              {dashboardPlan.actions.map((action) => (
                <Pressable key={`${action.label}-${action.screen}`} style={styles.secondaryButton} onPress={() => setScreen(action.screen)}>
                  <Text style={styles.secondaryButtonText}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Insights role</Text>
            <View style={styles.metricRows}>
              {dashboardPlan.highlights.map((row) => (
                <MetricRow key={row.label} label={row.label} value={row.value} />
              ))}
              {dashboardPlan.rows.map((row) => (
                <MetricRow key={`${row.label}-${row.value}`} label={row.label} value={row.value} />
              ))}
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>{isCommercial ? 'Prochains points' : user.role === 'hr_admin' ? 'Derniers pointages equipe' : 'Activite pointage'}</Text>
            {dashboardPlan.activity.length === 0 ? (
              <Text style={styles.muted}>Aucune activite synchronisee.</Text>
            ) : (
              dashboardPlan.activity.map((item, index) => (
                <View key={`${item.title}-${index}`} style={styles.activityItem}>
                  <View style={[styles.activityStripe, item.tone === 'amber' ? styles.activityAmber : item.tone === 'blue' ? styles.activityBlue : item.tone === 'slate' ? styles.activitySlate : styles.activityGreen]} />
                  <View style={styles.notificationContent}>
                    <Text style={styles.notificationTitle}>{item.title}</Text>
                    <Text style={styles.notificationMessage}>{item.detail}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Notifications</Text>
              {unreadCount > 0 ? (
                <Pressable style={styles.badgeButton} disabled={busy} onPress={markNotificationsRead}>
                  <Text style={styles.badgeText}>{unreadCount} non lues</Text>
                </Pressable>
              ) : null}
            </View>
            {notifications.length === 0 ? (
              <Text style={styles.muted}>Aucune notification pour le moment.</Text>
            ) : (
              notifications.map((item) => (
                <View key={item._id} style={styles.notificationItem}>
                  <View style={[styles.notificationDot, { backgroundColor: notificationTone(item.type) }]} />
                  <View style={styles.notificationContent}>
                    <Text style={styles.notificationTitle}>{item.title}</Text>
                    {item.message ? <Text style={styles.notificationMessage}>{item.message}</Text> : null}
                    <Text style={styles.muted}>{formatDateTime(item.createdAt)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Mes demandes conge</Text>
            {leaveRequests.length === 0 ? (
              <Text style={styles.muted}>Aucune demande envoyee.</Text>
            ) : (
              leaveRequests.map((item) => (
                <View key={item._id} style={styles.leaveItem}>
                  <View>
                    <Text style={styles.notificationTitle}>{statusLabel(item.type)} · {item.fromDate} au {item.toDate}</Text>
                    {item.reason ? <Text style={styles.notificationMessage}>{item.reason}</Text> : null}
                  </View>
                  <Text style={[styles.statusPill, item.status === 'approved' ? styles.statusOk : item.status === 'rejected' ? styles.statusDanger : styles.statusNeutral]}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      {screen === 'pointage' && (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
        >
          <View style={styles.kpi}>
            <Text style={styles.kpiLabel}>Heures ce mois</Text>
            <Text style={styles.kpiValue}>{formatHours(workedMinutes)}</Text>
            <Text style={[styles.shiftStatus, activeShift ? styles.shiftActive : styles.shiftInactive]}>
              {activeShift
                ? pausedShift
                  ? 'Pause en cours'
                  : isCommercial
                    ? 'En travail - tracking GPS actif'
                    : 'En travail'
                : 'Hors travail'}
            </Text>
          </View>
          <View style={styles.gpsPanel}>
            <Text style={styles.pickerLabel}>Position avant pointage</Text>
            {lastGps ? (
              <>
                <Text style={styles.gpsText}>
                  {lastGps.lat}, {lastGps.lng}
                  {lastGps.accuracy != null ? ` · precision ${lastGps.accuracy} m` : ''}
                </Text>
                <Text style={styles.muted}>Capture {new Date(lastGps.capturedAt).toLocaleTimeString()}</Text>
                <Text
                  style={[
                    styles.integrityText,
                    integrity?.blocked
                      ? styles.integrityRejected
                      : integrity && integrity.suspicious.length > 0
                        ? styles.integrityWarning
                        : styles.integrityOk,
                  ]}
                >
                  {integrityLabel(integrity)}
                </Text>
                {integrity?.suspicious.length ? (
                  <Text style={integrity.blocked ? styles.error : styles.warning}>
                    Alertes: {integrity.suspicious.join(', ')}
                  </Text>
                ) : null}
                {lastGps.accuracy != null && lastGps.accuracy > 100 ? (
                  <Text style={styles.warning}>Precision faible: recapturez si le point n'est pas correct.</Text>
                ) : null}
                <View style={styles.gpsMapPreview}>
                  <MapView
                    style={styles.map}
                    initialRegion={{
                      latitude: lastGps.lat,
                      longitude: lastGps.lng,
                      latitudeDelta: 0.004,
                      longitudeDelta: 0.004,
                    }}
                    region={{
                      latitude: lastGps.lat,
                      longitude: lastGps.lng,
                      latitudeDelta: 0.004,
                      longitudeDelta: 0.004,
                    }}
                    scrollEnabled={false}
                    zoomEnabled={false}
                    pitchEnabled={false}
                    rotateEnabled={false}
                  >
                    {lastGps.accuracy != null && (
                      <MapCircle
                        center={{ latitude: lastGps.lat, longitude: lastGps.lng }}
                        radius={Math.max(10, Math.min(500, lastGps.accuracy))}
                        strokeColor={gpsAccuracyColor(lastGps.accuracy)}
                        fillColor={`${gpsAccuracyColor(lastGps.accuracy)}26`}
                        strokeWidth={2}
                      />
                    )}
                    <Marker
                      coordinate={{ latitude: lastGps.lat, longitude: lastGps.lng }}
                      title="Ma position"
                      description={lastGps.accuracy != null ? `Precision ${lastGps.accuracy} m` : 'Precision inconnue'}
                      pinColor="#0f172a"
                    />
                  </MapView>
                </View>
              </>
            ) : (
              <Text style={styles.muted}>Aucune position verifiee.</Text>
            )}
            <View style={styles.gpsActions}>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={verifyGps}>
                <Text style={styles.secondaryButtonText}>Verifier GPS</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.secondaryButton,
                  locationConfirmed && !gpsRejected && styles.confirmedButton,
                  (!lastGps || gpsRejected) && styles.disabledButton,
                ]}
                disabled={!lastGps || busy || gpsRejected}
                onPress={() => setLocationConfirmed(true)}
              >
                <Text style={[styles.secondaryButtonText, locationConfirmed && !gpsRejected && styles.confirmedButtonText]}>
                  {locationConfirmed ? 'Position confirmee' : 'Confirmer'}
                </Text>
              </Pressable>
            </View>
          </View>
          <TextInput
            style={[styles.input, styles.note]}
            placeholder="Note optionnelle"
            value={note}
            onChangeText={setNote}
            multiline
          />
          <View style={styles.buttonGrid}>
            {(Object.keys(pointageLabels) as TimeLogType[]).map((type) => (
              <Pressable
                key={type}
                disabled={busy || !canUseConfirmedGps}
                style={[styles.primaryButton, !canUseConfirmedGps && styles.disabledButton]}
                onPress={() => punch(type)}
              >
                <Text style={styles.primaryButtonText}>{pointageLabels[type]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.leavePanel}>
            <Text style={styles.pickerLabel}>Demande conge</Text>
            <TextInput style={styles.input} placeholder="Debut YYYY-MM-DD" value={leaveFromDate} onChangeText={setLeaveFromDate} />
            <TextInput style={styles.input} placeholder="Fin YYYY-MM-DD" value={leaveToDate} onChangeText={setLeaveToDate} />
            <TextInput style={[styles.input, styles.note]} placeholder="Motif" multiline value={leaveReason} onChangeText={setLeaveReason} />
            <Pressable style={styles.secondaryButton} disabled={busy} onPress={requestLeave}>
              <Text style={styles.secondaryButtonText}>Envoyer demande</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      {isCommercial && screen === 'map' && (
        <View style={styles.mapScreen}>
          <View style={styles.mapToolbar}>
            <TextInput
              style={[styles.input, styles.mapSearchInput]}
              placeholder="Chercher point, tel, CIN..."
              value={pointSearch}
              onChangeText={setPointSearch}
            />
            <PickerRow label="Type" values={['all', ...pointTypes]} value={pointTypeFilter} onChange={(value) => setPointTypeFilter(value as PointFilter)} compact />
            <PickerRow label="Statut" values={['all', 'prospect', 'contact', 'contrat_signe', 'actif']} value={pointStatusFilter} onChange={(value) => setPointStatusFilter(value as StatusFilter)} compact />
          </View>
          <View style={styles.mapWrap}>
            <MapView style={styles.map} initialRegion={mapRegion} region={mapRegion}>
              {lastGps?.accuracy != null && (
                <MapCircle
                  center={{ latitude: lastGps.lat, longitude: lastGps.lng }}
                  radius={Math.max(10, Math.min(500, lastGps.accuracy))}
                  strokeColor={gpsAccuracyColor(lastGps.accuracy)}
                  fillColor={`${gpsAccuracyColor(lastGps.accuracy)}26`}
                  strokeWidth={2}
                />
              )}
              {zones.map((zone) => (
                <Polygon
                  key={zone._id}
                  coordinates={zone.polygon.map((point) => ({ latitude: point.lat, longitude: point.lng }))}
                  strokeColor={zone.color || '#2563eb'}
                  fillColor={`${zone.color || '#2563eb'}33`}
                  strokeWidth={2}
                />
              ))}
              {filteredPoints.map((point) =>
                point.gps?.lat && point.gps?.lng ? (
                  <Marker
	                    key={point._id}
	                    coordinate={{ latitude: point.gps.lat, longitude: point.gps.lng }}
	                    title={point.name}
	                    description={`${pointTypeLabel(point.type)} · ${statusLabel(point.status)}`}
	                    onPress={() => selectPoint(point._id).catch(() => undefined)}
	                  >
	                    <View style={[styles.pointMapMarker, { borderColor: pointTypeColor(point.type) }]}>
	                      <Text style={[styles.pointMapMarkerText, { color: pointTypeColor(point.type) }]}>{pointInitials(point.name)}</Text>
	                    </View>
	                  </Marker>
	                ) : null,
	              )}
              {lastGps && (
                <Marker
	                  coordinate={{ latitude: lastGps.lat, longitude: lastGps.lng }}
	                  title="Ma position"
	                  description={lastGps.accuracy != null ? `Precision ${lastGps.accuracy} m` : 'Precision inconnue'}
	                >
	                  <View style={styles.currentLocationMarker}>
	                    <View style={styles.currentLocationMarkerCore} />
	                  </View>
	                </Marker>
	              )}
            </MapView>
            <View style={styles.mapLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#7c3aed' }]} />
                <Text style={styles.legendText}>{mapCounters.points} points</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                <Text style={styles.legendText}>{mapCounters.activation} activation</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                <Text style={styles.legendText}>{mapCounters.recharge} recharge</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#2563eb' }]} />
                <Text style={styles.legendText}>{mapCounters.zones} zones</Text>
              </View>
            </View>
            {lastGps && (
              <View style={styles.mapStatus}>
                <Text style={styles.mapStatusTitle}>Ma position verifiee</Text>
                <Text style={[styles.mapStatusText, { color: gpsAccuracyColor(lastGps.accuracy) }]}>
                  {lastGps.accuracy != null ? `Precision ${lastGps.accuracy} m` : 'Precision inconnue'}
                </Text>
                <Text style={[styles.mapStatusText, gpsRejected ? styles.integrityRejected : styles.integrityOk]}>
                  {integrityLabel(integrity)}
                </Text>
              </View>
            )}
            {selectedPoint && (
              <View style={styles.selectedPointPanel}>
                <View style={styles.selectedPointHeader}>
                  <View style={styles.selectedPointText}>
                    <Text style={styles.mapStatusTitle}>{selectedPoint.name}</Text>
                    <Text style={styles.muted}>{pointTypeLabel(selectedPoint.type)} · {statusLabel(selectedPoint.status)} · {formatDistance(selectedDistance)}</Text>
                    <Text style={styles.muted}>{selectedPoint.phone || selectedPoint.city || selectedPoint.address || 'Point reseau'}</Text>
                    {selectedPoint.internalNotes ? <Text style={styles.selectedPointNote}>{selectedPoint.internalNotes}</Text> : null}
                  </View>
                  <View style={styles.selectedActions}>
                    <Pressable style={styles.smallPrimaryButton} onPress={() => openDirections(selectedPoint)}>
                      <Text style={styles.smallPrimaryButtonText}>Route</Text>
                    </Pressable>
                    <Pressable style={styles.smallSecondaryButton} onPress={() => selectPoint(selectedPoint._id, 'points').catch(() => undefined)}>
                      <Text style={styles.smallSecondaryButtonText}>Voir</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            )}
          </View>
        </View>
      )}

      {isCommercial && screen === 'points' && (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
        >
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Reseau commercial</Text>
              <Pressable style={styles.textButton} onPress={() => setScreen('newPoint')}>
                <Text style={styles.textButtonText}>Ajouter</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Recherche nom, tel, responsable, CIN..."
              value={pointSearch}
              onChangeText={setPointSearch}
            />
            <PickerRow label="Type" values={['all', ...pointTypes]} value={pointTypeFilter} onChange={(value) => setPointTypeFilter(value as PointFilter)} compact />
            <PickerRow label="Statut" values={['all', ...pointStatuses]} value={pointStatusFilter} onChange={(value) => setPointStatusFilter(value as StatusFilter)} compact />
          </View>

          {zones.length === 0 ? (
            <Text style={styles.warning}>Aucune zone assignee. Un responsable doit lier votre compte a une zone active.</Text>
          ) : null}

          <View style={styles.pointList}>
            {filteredPoints.length === 0 ? (
              <View style={styles.emptyPanel}>
                <Text style={styles.sectionTitle}>Aucun point trouve</Text>
                <Text style={styles.muted}>Changez les filtres ou creez un nouveau point terrain.</Text>
              </View>
            ) : (
              filteredPoints.map((point) => {
                const meters = distanceMeters(lastGps ? { lat: lastGps.lat, lng: lastGps.lng } : null, point.gps);
                return (
                  <Pressable
                    key={point._id}
                    style={[styles.pointCard, selectedPointId === point._id && styles.pointCardActive]}
                    onPress={() => selectPoint(point._id).catch(() => undefined)}
                  >
                    <View style={styles.pointCardHeader}>
                      <View style={[styles.typeStripe, { backgroundColor: pointTypeColor(point.type) }]} />
                      <View style={styles.pointCardText}>
                        <Text style={styles.pointName}>{point.name}</Text>
                        <Text style={styles.muted}>{pointTypeLabel(point.type)} · {statusLabel(point.status)} · {formatDistance(meters)}</Text>
                      </View>
                      <Text style={[styles.statusPill, point.status === 'actif' || point.status === 'contrat_signe' ? styles.statusOk : styles.statusNeutral]}>
                        {statusLabel(point.status)}
                      </Text>
                    </View>
                    <View style={styles.pointMetaGrid}>
                      <MetricRow label="Responsable" value={point.responsible || '-'} compact />
                      <MetricRow label="Tel" value={point.phone || point.phone2 || '-'} compact />
                      <MetricRow label="Ville" value={point.city || point.governorate || '-'} compact />
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>

          {selectedPoint ? (
            <PointDetail
              point={selectedPoint}
              overview={pointOverview}
              loading={pointOverviewBusy}
              products={products}
              allocationDraft={allocationDraft}
              setAllocationDraft={setAllocationDraft}
              busy={busy}
              onDirections={() => openDirections(selectedPoint)}
              onPhone={() => openPhone(selectedPoint.phone || selectedPoint.phone2)}
              onEmail={() => openMail(selectedPoint.email)}
              onAllocate={createAllocation}
            />
          ) : null}
        </ScrollView>
      )}

      {isCommercial && screen === 'newPoint' && (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />}
        >
          {zones.length === 0 ? (
            <Text style={styles.warning}>Aucune zone assignee. Un responsable doit lier votre compte a une zone active.</Text>
          ) : null}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Fiche point reseau</Text>
            <TextInput style={styles.input} placeholder="Nom du point" value={newPoint.name} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, name: value }))} />
            <PickerRow label="Type" values={pointTypes} value={newPoint.type} onChange={(value) => setNewPoint((prev) => ({ ...prev, type: value as NetworkPoint['type'] }))} />
            <PickerRow label="Statut" values={createPointStatuses} value={newPoint.status} onChange={(value) => setNewPoint((prev) => ({ ...prev, status: value as NetworkPoint['status'] }))} />
            {duplicateCandidates.length > 0 ? (
              <View style={styles.warningBox}>
                <Text style={styles.warningTitle}>Point similaire detecte</Text>
                {duplicateCandidates.map((point) => (
                  <Text key={point._id} style={styles.warningLine}>{point.name} · {point.phone || point.cin || point.city || 'reseau'}</Text>
                ))}
              </View>
            ) : null}
            <TextInput style={styles.input} placeholder="Adresse" value={newPoint.address} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, address: value }))} />
            <View style={styles.inlineInputs}>
              <TextInput style={[styles.input, styles.inlineInput]} placeholder="Ville" value={newPoint.city} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, city: value }))} />
              <TextInput style={[styles.input, styles.inlineInput]} placeholder="Gouvernorat" value={newPoint.governorate} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, governorate: value }))} />
            </View>
            <View style={styles.inlineInputs}>
              <TextInput style={[styles.input, styles.inlineInput]} placeholder="Prenom responsable" value={newPoint.responsibleFirstName} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, responsibleFirstName: value }))} />
              <TextInput style={[styles.input, styles.inlineInput]} placeholder="Nom responsable" value={newPoint.responsibleLastName} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, responsibleLastName: value }))} />
            </View>
            <TextInput style={styles.input} placeholder="Responsable affiche" value={newPoint.responsible} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, responsible: value }))} />
            <TextInput style={styles.input} placeholder="CIN" value={newPoint.cin} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, cin: value }))} />
            <TextInput style={styles.input} placeholder="Tel 1" keyboardType="phone-pad" value={newPoint.phone} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, phone: value }))} />
            <TextInput style={styles.input} placeholder="Tel 2" keyboardType="phone-pad" value={newPoint.phone2} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, phone2: value }))} />
            <TextInput style={styles.input} placeholder="Email" keyboardType="email-address" autoCapitalize="none" value={newPoint.email} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, email: value }))} />
            <TextInput style={[styles.input, styles.note]} placeholder="Note terrain, statut, prochaine action..." multiline value={newPoint.note} onChangeText={(value) => setNewPoint((prev) => ({ ...prev, note: value }))} />
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Position du point</Text>
            <PickerRow
              label="Source GPS"
              values={['current', 'pin']}
              value={pointLocationMode}
              onChange={(value) => setPointLocationMode(value as PointLocationMode)}
            />
            <View style={styles.pointMapPicker}>
              <MapView
                style={styles.map}
                initialRegion={mapRegion}
                region={pointGps ? {
                  latitude: pointGps.lat,
                  longitude: pointGps.lng,
                  latitudeDelta: 0.025,
                  longitudeDelta: 0.025,
                } : mapRegion}
                onPress={(event) => {
                  const lat = Number(event.nativeEvent.coordinate.latitude.toFixed(6));
                  const lng = Number(event.nativeEvent.coordinate.longitude.toFixed(6));
                  setPointLocationMode('pin');
                  setPointPin({ lat, lng });
                }}
              >
                {zones.map((zone) => (
                  <Polygon
                    key={zone._id}
                    coordinates={zone.polygon.map((point) => ({ latitude: point.lat, longitude: point.lng }))}
                    strokeColor={zone.color || '#2563eb'}
                    fillColor={`${zone.color || '#2563eb'}22`}
                    strokeWidth={2}
                  />
                ))}
                {points.map((point) =>
                  point.gps?.lat && point.gps?.lng ? (
	                    <Marker
	                      key={point._id}
	                      coordinate={{ latitude: point.gps.lat, longitude: point.gps.lng }}
	                      title={point.name}
	                      description={`${pointTypeLabel(point.type)} · ${point.status}`}
	                    >
	                      <View style={[styles.pointMapMarkerSmall, { borderColor: pointTypeColor(point.type) }]}>
	                        <Text style={[styles.pointMapMarkerSmallText, { color: pointTypeColor(point.type) }]}>{pointInitials(point.name)}</Text>
	                      </View>
	                    </Marker>
	                  ) : null,
	                )}
                {lastGps && (
                  <>
                    {lastGps.accuracy != null && (
                      <MapCircle
                        center={{ latitude: lastGps.lat, longitude: lastGps.lng }}
                        radius={Math.max(10, Math.min(500, lastGps.accuracy))}
                        strokeColor={gpsAccuracyColor(lastGps.accuracy)}
                        fillColor={`${gpsAccuracyColor(lastGps.accuracy)}24`}
                        strokeWidth={2}
                      />
                    )}
	                    <Marker coordinate={{ latitude: lastGps.lat, longitude: lastGps.lng }} title="GPS actuel">
	                      <View style={styles.currentLocationMarker}>
	                        <View style={styles.currentLocationMarkerCore} />
	                      </View>
	                    </Marker>
                  </>
                )}
                {pointGps && (
	                  <Marker
	                    coordinate={{ latitude: pointGps.lat, longitude: pointGps.lng }}
	                    title={pointLocationMode === 'pin' ? 'Point choisi' : 'GPS actuel'}
	                  >
	                    <View style={styles.newPointMarker}>
	                      <Text style={styles.newPointMarkerText}>+</Text>
	                    </View>
	                  </Marker>
	                )}
              </MapView>
            </View>
            <Text style={styles.muted}>
              {pointGps
                ? `${pointGps.lat}, ${pointGps.lng}${pointGps.accuracy != null ? ` · precision ${pointGps.accuracy} m` : ''}`
                : 'Touchez la carte ou verifiez le GPS actuel.'}
            </Text>
            <View style={styles.gpsActions}>
              <Pressable style={styles.secondaryButton} disabled={busy} onPress={verifyGps}>
                <Text style={styles.secondaryButtonText}>Verifier GPS actuel</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.secondaryButton,
                  locationConfirmed && !gpsRejected && styles.confirmedButton,
                  (!lastGps || gpsRejected) && styles.disabledButton,
                ]}
                disabled={!lastGps || busy || gpsRejected}
                onPress={() => setLocationConfirmed(true)}
              >
                <Text style={[styles.secondaryButtonText, locationConfirmed && !gpsRejected && styles.confirmedButtonText]}>
                  {locationConfirmed ? 'Position source confirmee' : 'Confirmer source'}
                </Text>
              </Pressable>
            </View>
            {!canUseConfirmedGps ? (
              <Text style={styles.warning}>Confirmez votre position GPS source avant d envoyer la fiche, meme si le point est place manuellement.</Text>
            ) : null}
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Documents & signature</Text>
            <ImagePickerRow label="Preuve CIN" image={cinImage} onPick={(source) => pickPointImage('cin', source)} />
            <ImagePickerRow label="Image boutique" image={shopImage} onPick={(source) => pickPointImage('shop', source)} />
            <Text style={styles.pickerLabel}>Signature responsable</Text>
            <SignaturePad value={signatureTrace} onChange={setSignatureTrace} />
          </View>
          <Pressable
            style={[styles.primaryButton, (!pointGps || !canUseConfirmedGps || zones.length === 0 || signatureTrace.length === 0) && styles.disabledButton]}
            disabled={busy || !pointGps || !canUseConfirmedGps || zones.length === 0 || signatureTrace.length === 0}
            onPress={createNetworkPoint}
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Enregistrement...' : 'Ajouter point + fiche signee'}</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function MiniKpi({
  label,
  value,
  detail,
  tone = 'green',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'green' | 'blue' | 'amber' | 'slate';
}) {
  const toneStyle =
    tone === 'blue' ? styles.kpiToneBlue : tone === 'amber' ? styles.kpiToneAmber : tone === 'slate' ? styles.kpiToneSlate : styles.kpiToneGreen;
  return (
    <View style={[styles.miniKpi, toneStyle]}>
      <Text style={styles.miniKpiLabel}>{label}</Text>
      <Text style={styles.miniKpiValue}>{value}</Text>
      {detail ? <Text style={styles.miniKpiDetail} numberOfLines={1}>{detail}</Text> : null}
    </View>
  );
}

function MetricRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <View style={[styles.metricRow, compact && styles.metricRowCompact]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={compact ? 1 : 2}>{value}</Text>
    </View>
  );
}

function PointDetail({
  point,
  overview,
  loading,
  products,
  allocationDraft,
  setAllocationDraft,
  busy,
  onDirections,
  onPhone,
  onEmail,
  onAllocate,
}: {
  point: NetworkPoint;
  overview: PointOverview | null;
  loading: boolean;
  products: ProductLite[];
  allocationDraft: { kind: AllocationKind; productId: string; amount: string; barcodes: string; note: string };
  setAllocationDraft: (next: { kind: AllocationKind; productId: string; amount: string; barcodes: string; note: string }) => void;
  busy: boolean;
  onDirections: () => void;
  onPhone: () => void;
  onEmail: () => void;
  onAllocate: () => void;
}) {
  const selectedProduct = products.find((product) => product._id === allocationDraft.productId);
  const barcodes = splitBarcodes(allocationDraft.barcodes);
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <View style={styles.selectedPointText}>
          <Text style={styles.sectionTitle}>{point.name}</Text>
          <Text style={styles.muted}>{pointTypeLabel(point.type)} · {statusLabel(point.status)}</Text>
        </View>
        {loading ? <ActivityIndicator color="#0f172a" /> : null}
      </View>

      <View style={styles.detailGrid}>
        <MetricRow label="Responsable" value={point.responsible || '-'} compact />
        <MetricRow label="CIN" value={point.cin || '-'} compact />
        <MetricRow label="Tel 1" value={point.phone || '-'} compact />
        <MetricRow label="Tel 2" value={point.phone2 || '-'} compact />
        <MetricRow label="Email" value={point.email || '-'} compact />
        <MetricRow label="Adresse" value={[point.address, point.city, point.governorate].filter(Boolean).join(', ') || '-'} compact />
      </View>

      <View style={styles.actionGrid}>
        <Pressable style={styles.secondaryButton} onPress={onDirections}>
          <Text style={styles.secondaryButtonText}>Itineraire</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onPhone}>
          <Text style={styles.secondaryButtonText}>Appeler</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onEmail}>
          <Text style={styles.secondaryButtonText}>Email</Text>
        </Pressable>
      </View>

      <View style={styles.kpiGrid}>
        <MiniKpi label="Solde mois" value={formatMoney(overview?.monthly.amount)} tone="blue" />
        <MiniKpi label="SIM mois" value={String(overview?.monthly.barcodeCount ?? 0)} />
        <MiniKpi label="Solde total" value={formatMoney(overview?.totals.amount)} tone="slate" />
        <MiniKpi label="SIM total" value={String(overview?.totals.barcodeCount ?? 0)} tone="amber" />
      </View>

      <View style={styles.sectionDivider} />
      <Text style={styles.sectionTitle}>Dotation point</Text>
      <PickerRow
        label="Type dotation"
        values={['recharge', 'sim', 'other']}
        value={allocationDraft.kind}
        onChange={(value) => setAllocationDraft({ ...allocationDraft, kind: value as AllocationKind })}
        compact
      />
      {allocationDraft.kind === 'sim' ? (
        <>
          <PickerRow
            label="Produit SIM"
            values={products.slice(0, 12).map((product) => product._id)}
            value={allocationDraft.productId}
            onChange={(value) => setAllocationDraft({ ...allocationDraft, productId: value })}
            compact
            labels={products.reduce<Record<string, string>>((acc, product) => {
              acc[product._id] = product.reference ? `${product.reference}` : product.name;
              return acc;
            }, {})}
          />
          {selectedProduct ? <Text style={styles.muted}>{selectedProduct.name}</Text> : null}
          <TextInput
            style={[styles.input, styles.note]}
            placeholder="Codes-barres SIM, un par ligne ou separes par virgule"
            value={allocationDraft.barcodes}
            onChangeText={(value) => setAllocationDraft({ ...allocationDraft, barcodes: value })}
            multiline
            autoCapitalize="none"
          />
          <Text style={styles.muted}>{barcodes.length} code(s) prets a envoyer</Text>
        </>
      ) : (
        <TextInput
          style={styles.input}
          placeholder="Montant solde TND"
          keyboardType="numeric"
          value={allocationDraft.amount}
          onChangeText={(value) => setAllocationDraft({ ...allocationDraft, amount: value })}
        />
      )}
      <TextInput
        style={[styles.input, styles.note]}
        placeholder="Note dotation"
        value={allocationDraft.note}
        onChangeText={(value) => setAllocationDraft({ ...allocationDraft, note: value })}
        multiline
      />
      <Pressable style={[styles.primaryButton, busy && styles.disabledButton]} disabled={busy} onPress={onAllocate}>
        <Text style={styles.primaryButtonText}>{busy ? 'Envoi...' : 'Enregistrer dotation'}</Text>
      </Pressable>

      <View style={styles.sectionDivider} />
      <Text style={styles.sectionTitle}>Dernieres dotations</Text>
      {overview?.allocations?.length ? (
        overview.allocations.slice(0, 8).map((allocation) => (
          <View key={allocation._id} style={styles.allocationItem}>
            <View>
              <Text style={styles.notificationTitle}>
                {allocation.kind.toUpperCase()} · {allocation.kind === 'recharge' ? formatMoney(allocation.amount) : `${allocation.barcodeCount ?? allocation.barcodes?.length ?? allocation.quantity} SIM`}
              </Text>
              <Text style={styles.muted}>{formatDateTime(allocation.createdAt)}</Text>
            </View>
            {allocation.note ? <Text style={styles.allocationNote}>{allocation.note}</Text> : null}
          </View>
        ))
      ) : (
        <Text style={styles.muted}>Aucune dotation enregistree pour ce point.</Text>
      )}
    </View>
  );
}

function PickerRow({
  label,
  values,
  value,
  onChange,
  compact = false,
  labels,
}: {
  label: string;
  values: string[];
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  labels?: Record<string, string>;
}) {
  return (
    <View style={[styles.pickerRow, compact && styles.pickerRowCompact]}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <View style={styles.chips}>
        {values.map((item) => (
          <Pressable key={item} style={[styles.chip, compact && styles.chipCompact, value === item && styles.chipActive]} onPress={() => onChange(item)}>
            <Text style={[styles.chipText, compact && styles.chipTextCompact, value === item && styles.chipTextActive]}>{labels?.[item] ?? item}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ImagePickerRow({
  label,
  image,
  onPick,
}: {
  label: string;
  image: PickedImage | null;
  onPick: (source: 'camera' | 'library') => void;
}) {
  return (
    <View style={styles.imagePickerRow}>
      <View style={styles.imagePreview}>
        {image ? <Image source={{ uri: image.uri }} style={styles.imagePreviewImage} /> : <Text style={styles.imagePreviewText}>Aucune image</Text>}
      </View>
      <View style={styles.imagePickerContent}>
        <Text style={styles.pickerLabel}>{label}</Text>
        <Text style={styles.muted}>{image?.name ?? 'Photo ou galerie'}</Text>
        <View style={styles.inlineInputs}>
          <Pressable style={[styles.secondaryButton, styles.inlineInput]} onPress={() => onPick('camera')}>
            <Text style={styles.secondaryButtonText}>Camera</Text>
          </Pressable>
          <Pressable style={[styles.secondaryButton, styles.inlineInput]} onPress={() => onPick('library')}>
            <Text style={styles.secondaryButtonText}>Galerie</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SignaturePad({ value, onChange }: { value: SignatureTrace; onChange: (value: SignatureTrace) => void }) {
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const currentStroke = useRef<SignaturePoint[]>([]);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const addPoint = (x: number, y: number, fresh = false) => {
    const point = {
      x: Math.max(0, Math.min(1, x / layout.width)),
      y: Math.max(0, Math.min(1, y / layout.height)),
    };
    if (fresh) {
      currentStroke.current = [point];
      onChange([...valueRef.current, currentStroke.current]);
      return;
    }
    const last = currentStroke.current[currentStroke.current.length - 1];
    if (last && Math.hypot(last.x - point.x, last.y - point.y) < 0.01) return;
    currentStroke.current = [...currentStroke.current, point];
    const previous = valueRef.current.slice(0, -1);
    onChange([...previous, currentStroke.current]);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          addPoint(event.nativeEvent.locationX, event.nativeEvent.locationY, true);
        },
        onPanResponderMove: (event) => {
          addPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
        },
        onPanResponderRelease: () => {
          currentStroke.current = [];
        },
        onPanResponderTerminate: () => {
          currentStroke.current = [];
        },
      }),
    [layout.height, layout.width],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout({ width: Math.max(1, width), height: Math.max(1, height) });
  };

  return (
    <View>
      <View style={styles.signatureBox} onLayout={onLayout} {...panResponder.panHandlers}>
        {value.flatMap((stroke, strokeIndex) =>
          stroke.map((point, pointIndex) => (
            <View
              key={`${strokeIndex}-${pointIndex}`}
              style={[
                styles.signatureDot,
                {
                  left: point.x * layout.width - 2,
                  top: point.y * layout.height - 2,
                },
              ]}
            />
          )),
        )}
      </View>
      <View style={styles.gpsActions}>
        <Pressable style={styles.secondaryButton} onPress={() => onChange([])}>
          <Text style={styles.secondaryButtonText}>Effacer signature</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 16,
    paddingTop: 54,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  loginPanel: {
    gap: 14,
    paddingTop: 72,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  brand: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  muted: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 4,
  },
  link: {
    color: '#0369a1',
    fontWeight: '700',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 14,
    color: '#0f172a',
  },
  note: {
    minHeight: 86,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '800',
  },
  disabledButton: {
    opacity: 0.45,
  },
  confirmedButton: {
    borderColor: '#86efac',
    backgroundColor: '#dcfce7',
  },
  confirmedButtonText: {
    color: '#166534',
  },
  gpsPanel: {
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
  },
  gpsText: {
    color: '#0f172a',
    fontWeight: '800',
  },
  integrityText: {
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontWeight: '800',
  },
  integrityOk: {
    color: '#166534',
    backgroundColor: '#dcfce7',
  },
  integrityWarning: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
  },
  integrityRejected: {
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
  },
  gpsActions: {
    gap: 8,
  },
  inlineInputs: {
    flexDirection: 'row',
    gap: 8,
  },
  inlineInput: {
    flex: 1,
  },
  gpsMapPreview: {
    height: 190,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  warning: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontWeight: '700',
  },
  error: {
    color: '#dc2626',
    fontWeight: '700',
  },
  notice: {
    color: '#075985',
    backgroundColor: '#e0f2fe',
    borderColor: '#bae6fd',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    fontWeight: '700',
  },
  tabsScroll: {
    maxHeight: 64,
    marginBottom: 12,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 4,
    gap: 4,
  },
  tab: {
    minHeight: 54,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    paddingHorizontal: 12,
  },
  tabActive: {
    backgroundColor: '#ffffff',
  },
  tabText: {
    color: '#cbd5e1',
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#0f172a',
  },
  tabMeta: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  statusRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statusChip: {
    flexGrow: 1,
    minWidth: '45%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusChipButton: {
    flexGrow: 1,
    minWidth: '45%',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusChipGreen: {
    borderColor: '#86efac',
    backgroundColor: '#ecfdf5',
  },
  statusChipSlate: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  statusChipLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  statusChipValue: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 3,
  },
  content: {
    gap: 12,
    paddingBottom: 40,
  },
  heroPanel: {
    borderRadius: 8,
    backgroundColor: '#0f172a',
    padding: 16,
    gap: 10,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroText: {
    flex: 1,
  },
  heroEyebrow: {
    color: '#93c5fd',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 25,
    fontWeight: '900',
    marginTop: 3,
  },
  heroCopy: {
    color: '#cbd5e1',
    lineHeight: 20,
    fontWeight: '600',
  },
  liveBadge: {
    minHeight: 40,
    minWidth: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  liveBadgeOn: {
    backgroundColor: '#dcfce7',
  },
  liveBadgeOff: {
    backgroundColor: '#e2e8f0',
  },
  liveBadgeText: {
    fontWeight: '900',
  },
  liveBadgeTextOn: {
    color: '#166534',
  },
  liveBadgeTextOff: {
    color: '#475569',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  miniKpi: {
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 86,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  kpiToneGreen: {
    backgroundColor: '#ecfdf5',
    borderColor: '#bbf7d0',
  },
  kpiToneBlue: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  kpiToneAmber: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  kpiToneSlate: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  miniKpiLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  miniKpiValue: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '900',
  },
  miniKpiDetail: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  kpi: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 16,
  },
  kpiLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  kpiValue: {
    color: '#0f172a',
    fontSize: 34,
    fontWeight: '900',
    marginTop: 4,
  },
  shiftStatus: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    marginTop: 10,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '800',
  },
  shiftActive: {
    backgroundColor: '#dcfce7',
    color: '#166534',
  },
  shiftInactive: {
    backgroundColor: '#e2e8f0',
    color: '#475569',
  },
  buttonGrid: {
    gap: 10,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricRows: {
    gap: 8,
  },
  metricRow: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  metricRowCompact: {
    minHeight: 40,
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '800',
  },
  metricValue: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
    flexShrink: 1,
    textAlign: 'right',
  },
  leavePanel: {
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
  },
  sectionCard: {
    gap: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
  },
  sectionTitle: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '900',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 4,
  },
  textButton: {
    minHeight: 38,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  textButtonText: {
    color: '#0369a1',
    fontWeight: '900',
  },
  badgeText: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '900',
  },
  badgeButton: {
    minHeight: 34,
    justifyContent: 'center',
  },
  syncText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  activityItem: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  activityStripe: {
    width: 5,
    alignSelf: 'stretch',
    borderRadius: 999,
  },
  activityGreen: {
    backgroundColor: '#16a34a',
  },
  activityBlue: {
    backgroundColor: '#2563eb',
  },
  activityAmber: {
    backgroundColor: '#d97706',
  },
  activitySlate: {
    backgroundColor: '#64748b',
  },
  notificationItem: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  notificationDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    marginTop: 5,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    color: '#0f172a',
    fontWeight: '900',
  },
  notificationMessage: {
    color: '#475569',
    marginTop: 3,
    lineHeight: 18,
  },
  leaveItem: {
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
  },
  statusPill: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: '900',
  },
  statusOk: {
    color: '#166534',
    backgroundColor: '#dcfce7',
  },
  statusDanger: {
    color: '#b91c1c',
    backgroundColor: '#fee2e2',
  },
  statusNeutral: {
    color: '#475569',
    backgroundColor: '#e2e8f0',
  },
  mapScreen: {
    flex: 1,
    gap: 10,
  },
  mapToolbar: {
    gap: 8,
  },
  mapSearchInput: {
    minHeight: 44,
  },
  mapWrap: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  map: {
    flex: 1,
  },
  pointMapMarker: {
    minWidth: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 3,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 4,
  },
  pointMapMarkerText: {
    fontSize: 11,
    fontWeight: '900',
  },
  pointMapMarkerSmall: {
    minWidth: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointMapMarkerSmallText: {
    fontSize: 9,
    fontWeight: '900',
  },
  currentLocationMarker: {
    height: 28,
    width: 28,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationMarkerCore: {
    height: 10,
    width: 10,
    borderRadius: 999,
    backgroundColor: '#38bdf8',
  },
  newPointMarker: {
    height: 34,
    width: 34,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#ffffff',
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newPointMarkerText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 24,
  },
  mapStatus: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mapStatusTitle: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  mapStatusText: {
    marginTop: 2,
    fontWeight: '800',
  },
  selectedPointPanel: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 82,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mapLegend: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  legendDot: {
    height: 8,
    width: 8,
    borderRadius: 999,
  },
  legendText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '800',
  },
  selectedPointHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedActions: {
    gap: 6,
  },
  selectedPointText: {
    flex: 1,
  },
  selectedPointNote: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  smallPrimaryButton: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallPrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 12,
  },
  smallSecondaryButton: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  smallSecondaryButtonText: {
    color: '#0f172a',
    fontWeight: '900',
    fontSize: 12,
  },
  pointList: {
    gap: 10,
  },
  emptyPanel: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 14,
    gap: 4,
  },
  pointCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 12,
    gap: 10,
  },
  pointCardActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  pointCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  typeStripe: {
    width: 5,
    alignSelf: 'stretch',
    borderRadius: 999,
  },
  pointCardText: {
    flex: 1,
  },
  pointName: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '900',
  },
  pointMetaGrid: {
    gap: 6,
  },
  detailGrid: {
    gap: 6,
  },
  pointMapPicker: {
    height: 280,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  pickerRow: {
    gap: 8,
  },
  pickerRowCompact: {
    gap: 6,
  },
  pickerLabel: {
    color: '#475569',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipCompact: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: '#0f172a',
    backgroundColor: '#0f172a',
  },
  chipText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 12,
  },
  chipTextCompact: {
    fontSize: 11,
  },
  chipTextActive: {
    color: '#ffffff',
  },
  imagePickerRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#f8fafc',
  },
  imagePreview: {
    height: 82,
    width: 82,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  imagePreviewImage: {
    height: '100%',
    width: '100%',
  },
  imagePreviewText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  imagePickerContent: {
    flex: 1,
    gap: 6,
  },
  signatureBox: {
    height: 170,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  signatureDot: {
    position: 'absolute',
    height: 4,
    width: 4,
    borderRadius: 2,
    backgroundColor: '#0f172a',
  },
  warningBox: {
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  warningTitle: {
    color: '#92400e',
    fontWeight: '900',
  },
  warningLine: {
    color: '#92400e',
    fontWeight: '700',
  },
  allocationItem: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 10,
    gap: 4,
  },
  allocationNote: {
    color: '#334155',
    fontWeight: '700',
  },
});
