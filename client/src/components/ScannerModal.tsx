import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Html5Qrcode, Html5QrcodeSupportedFormats, type Html5QrcodeCameraScanConfig } from 'html5-qrcode';
import { Camera, Crosshair, Flashlight, FlashlightOff, ImageUp, Pause, Play, RefreshCcw, Ruler, X } from 'lucide-react';

interface ScannerModalProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  onError?: (error: string) => void;
}

interface CameraDeviceOption {
  id: string;
  label: string;
}

type ScanPreset = 'far' | 'balanced' | 'compact';

interface ScannerTuning {
  preset: ScanPreset;
  boxWidthPct: number;
  boxHeightPct: number;
  highResolution: boolean;
  autoZoom: boolean;
}

const SCANNER_CAMERA_KEY = 'asel-pos-scanner-camera';
const SCANNER_TUNING_KEY = 'asel-pos-scanner-tuning';
const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.DATA_MATRIX,
  Html5QrcodeSupportedFormats.QR_CODE,
];

const PRESET_TUNING: Record<ScanPreset, ScannerTuning> = {
  far: {
    preset: 'far',
    boxWidthPct: 96,
    boxHeightPct: 34,
    highResolution: true,
    autoZoom: true,
  },
  balanced: {
    preset: 'balanced',
    boxWidthPct: 88,
    boxHeightPct: 28,
    highResolution: true,
    autoZoom: false,
  },
  compact: {
    preset: 'compact',
    boxWidthPct: 70,
    boxHeightPct: 22,
    highResolution: false,
    autoZoom: false,
  },
};

const PRESET_LABELS: Record<ScanPreset, string> = {
  far: '100cm',
  balanced: 'Standard',
  compact: 'Precis',
};

const SCAN_PRESETS: ScanPreset[] = ['far', 'balanced', 'compact'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : fallback;
}

function isScanPreset(value: unknown): value is ScanPreset {
  return value === 'far' || value === 'balanced' || value === 'compact';
}

function cameraLabel(camera: CameraDeviceOption, index: number): string {
  return camera.label?.trim() || `Camera ${index + 1}`;
}

function pickPreferredCamera(cameras: CameraDeviceOption[], preferredId?: string | null): CameraDeviceOption | null {
  if (preferredId) {
    const saved = cameras.find((camera) => camera.id === preferredId);
    if (saved) return saved;
  }

  const scored = cameras
    .map((camera, index) => {
      const label = cameraLabel(camera, index).toLowerCase();
      let score = 0;
      if (/(back|rear|environment|world)/.test(label)) score += 100;
      if (/(tele|zoom|2x|3x)/.test(label)) score += 35;
      if (/(main|standard)/.test(label)) score += 20;
      if (/(ultra[\s-]?wide|0\.5x)/.test(label)) score -= 35;
      if (/(front|facetime|user)/.test(label)) score -= 50;
      return { camera, score };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.camera ?? null;
}

function toScannerMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/permission|notallowed/i.test(raw)) {
    return 'Autorisation caméra refusée. Activez la caméra pour le scan ou utilisez la saisie manuelle.';
  }
  if (/notfound|device not found|no camera/i.test(raw)) {
    return 'Aucune caméra exploitable détectée. Utilisez la saisie manuelle.';
  }
  return raw || 'Impossible de démarrer le scanner.';
}

function readStoredTuning(): ScannerTuning {
  if (typeof window === 'undefined') return PRESET_TUNING.far;

  try {
    const stored = window.localStorage.getItem(SCANNER_TUNING_KEY);
    if (!stored) return PRESET_TUNING.far;

    const parsed = JSON.parse(stored) as Partial<ScannerTuning> | null;
    const base = isScanPreset(parsed?.preset) ? PRESET_TUNING[parsed.preset] : PRESET_TUNING.far;

    return {
      preset: base.preset,
      boxWidthPct: clampNumber(parsed?.boxWidthPct, base.boxWidthPct, 55, 100),
      boxHeightPct: clampNumber(parsed?.boxHeightPct, base.boxHeightPct, 16, 60),
      highResolution: typeof parsed?.highResolution === 'boolean' ? parsed.highResolution : base.highResolution,
      autoZoom: typeof parsed?.autoZoom === 'boolean' ? parsed.autoZoom : base.autoZoom,
    };
  } catch {
    return PRESET_TUNING.far;
  }
}

function cameraChoiceToVideoConstraints(
  cameraChoice: string | MediaTrackConstraints,
  tuning: ScannerTuning,
  relaxed = false,
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints =
    typeof cameraChoice === 'string' ? { deviceId: { exact: cameraChoice } } : { ...cameraChoice };

  const highResolution = tuning.highResolution && !relaxed;
  const widthIdeal = highResolution ? (tuning.preset === 'far' ? 2560 : 1920) : 1280;
  const heightIdeal = highResolution ? (tuning.preset === 'far' ? 1440 : 1080) : 720;

  constraints.width = { ideal: relaxed ? 1280 : widthIdeal };
  constraints.height = { ideal: relaxed ? 720 : heightIdeal };
  constraints.frameRate = { ideal: relaxed ? 16 : tuning.preset === 'far' ? 24 : 18, max: 30 };

  if (!relaxed) {
    constraints.advanced = [
      { focusMode: 'continuous' } as MediaTrackConstraintSet,
      { exposureMode: 'continuous' } as MediaTrackConstraintSet,
      { whiteBalanceMode: 'continuous' } as MediaTrackConstraintSet,
    ];
  }

  return constraints;
}

function scannerConfigFor(
  cameraChoice: string | MediaTrackConstraints,
  tuning: ScannerTuning,
  relaxed = false,
): Html5QrcodeCameraScanConfig {
  return {
    fps: relaxed ? 12 : tuning.preset === 'far' ? 18 : 14,
    aspectRatio: 16 / 9,
    disableFlip: true,
    videoConstraints: cameraChoiceToVideoConstraints(cameraChoice, tuning, relaxed),
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      const inset = viewfinderWidth < 280 || viewfinderHeight < 180 ? 8 : 24;
      const maxWidth = Math.max(80, viewfinderWidth - inset);
      const maxHeight = Math.max(60, viewfinderHeight - inset);
      const minWidth = Math.min(maxWidth, tuning.preset === 'compact' ? 180 : 240);
      const minHeight = Math.min(maxHeight, tuning.preset === 'compact' ? 72 : 96);

      return {
        width: Math.round(clamp(viewfinderWidth * (tuning.boxWidthPct / 100), minWidth, maxWidth)),
        height: Math.round(clamp(viewfinderHeight * (tuning.boxHeightPct / 100), minHeight, maxHeight)),
      };
    },
  };
}

export function ScannerModal({ onScan, onClose, onError }: ScannerModalProps) {
  const reactId = useId();
  const elementId = useMemo(() => `barcode-reader-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const opRef = useRef(0);
  const scanRef = useRef({ text: '', at: 0 });

  const [cameras, setCameras] = useState<CameraDeviceOption[]>([]);
  const [tuning, setTuning] = useState<ScannerTuning>(() => readStoredTuning());
  const tuningRef = useRef(tuning);
  const [tuningDirty, setTuningDirty] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [status, setStatus] = useState('Recherche des cameras...');
  const [manualCode, setManualCode] = useState('');
  const [lastDecoded, setLastDecoded] = useState('');
  const [starting, setStarting] = useState(true);
  const [paused, setPaused] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(1);
  const [zoomStep, setZoomStep] = useState(0.1);
  const [zoomValue, setZoomValue] = useState(1);
  const [zoomSupported, setZoomSupported] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    tuningRef.current = tuning;

    try {
      window.localStorage.setItem(SCANNER_TUNING_KEY, JSON.stringify(tuning));
    } catch {
      // ignore private-mode storage errors
    }
  }, [tuning]);

  const stopScanner = useCallback(async () => {
    opRef.current += 1;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;

    try {
      if (scanner.isScanning) await scanner.stop();
    } catch {
      // ignore shutdown errors
    }

    try {
      scanner.clear();
    } catch {
      // ignore UI clear errors
    }
  }, []);

  const syncCapabilities = useCallback(async (scanner: Html5Qrcode) => {
    try {
      const capabilities = scanner.getRunningTrackCameraCapabilities();
      const torch = capabilities.torchFeature();
      const zoom = capabilities.zoomFeature();

      if (torch.isSupported()) {
        setTorchSupported(true);
        setTorchEnabled(Boolean(torch.value()));
      } else {
        setTorchSupported(false);
        setTorchEnabled(false);
      }

      if (zoom.isSupported()) {
        const nextMin = zoom.min();
        const nextMax = zoom.max();
        const nextStep = zoom.step();
        let nextValue = zoom.value() ?? nextMin;

        if (tuningRef.current.autoZoom && nextMax > nextMin) {
          const rawTarget = Math.min(2.4, nextMin + (nextMax - nextMin) * 0.38);
          const steppedTarget = nextStep ? Math.round(rawTarget / nextStep) * nextStep : rawTarget;
          const target = clamp(Number(steppedTarget.toFixed(2)), nextMin, nextMax);

          if (Math.abs(target - nextValue) >= (nextStep || 0.1) / 2) {
            try {
              await zoom.apply(target);
              nextValue = target;
            } catch {
              // Some browsers expose zoom ranges but reject applying them.
            }
          }
        }

        setZoomSupported(true);
        setZoomMin(nextMin);
        setZoomMax(nextMax);
        setZoomStep(nextStep || 0.1);
        setZoomValue(nextValue);
      } else {
        setZoomSupported(false);
        setZoomMin(1);
        setZoomMax(1);
        setZoomStep(0.1);
        setZoomValue(1);
      }
    } catch {
      setTorchSupported(false);
      setTorchEnabled(false);
      setZoomSupported(false);
      setZoomMin(1);
      setZoomMax(1);
      setZoomStep(0.1);
      setZoomValue(1);
    }
  }, []);

  const reportScan = useCallback(
    (decodedText: string, source: 'camera' | 'image' | 'manual') => {
      const code = decodedText.trim();
      if (!code) return;

      const now = Date.now();
      if (source === 'camera' && scanRef.current.text === code && now - scanRef.current.at < 1500) return;

      scanRef.current = { text: code, at: now };
      setLastDecoded(code);
      setStatus(source === 'manual' ? `Code manuel utilise: ${code}` : `Code detecte: ${code}`);
      navigator.vibrate?.(source === 'manual' ? 20 : 45);
      onScan(code);
    },
    [onScan],
  );

  const startScanner = useCallback(
    async (cameraChoice: string | MediaTrackConstraints, label?: string) => {
      const token = ++opRef.current;
      setStarting(true);
      setPaused(false);
      setStatus(label ? `Demarrage ${label}...` : 'Demarrage camera...');

      const previous = scannerRef.current;
      scannerRef.current = null;
      if (previous) {
        try {
          if (previous.isScanning) await previous.stop();
        } catch {
          // ignore switch errors
        }
        try {
          previous.clear();
        } catch {
          // ignore switch clear errors
        }
      }

      if (!mountedRef.current || token !== opRef.current) return;

      const scanner = new Html5Qrcode(elementId, {
        verbose: false,
        formatsToSupport: SUPPORTED_FORMATS,
        useBarCodeDetectorIfSupported: true,
      });
      scannerRef.current = scanner;

      try {
        const startWithTuning = (relaxed: boolean) =>
          scanner.start(
            cameraChoice,
            scannerConfigFor(cameraChoice, tuningRef.current, relaxed),
            (decodedText) => {
              reportScan(decodedText, 'camera');
            },
            () => {
              // ignore frame-level misses
            },
          );

        try {
          await startWithTuning(false);
        } catch (firstError) {
          if (!tuningRef.current.highResolution) throw firstError;

          setStatus('Mode compatibilite camera...');
          await startWithTuning(true);
        }

        if (!mountedRef.current || token !== opRef.current) {
          try {
            await scanner.stop();
          } catch {
            // ignore cancellation errors
          }
          try {
            scanner.clear();
          } catch {
            // ignore cancellation clear errors
          }
          return;
        }

        setStarting(false);
        setStatus(label ? `Camera prete: ${label}` : 'Camera prete');
        await syncCapabilities(scanner);
      } catch (error) {
        const message = toScannerMessage(error);
        if (scannerRef.current === scanner) scannerRef.current = null;
        try {
          scanner.clear();
        } catch {
          // ignore failed-start clear errors
        }
        setTorchSupported(false);
        setTorchEnabled(false);
        setZoomSupported(false);
        setStarting(false);
        setStatus(message);
        onError?.(message);
      }
    },
    [elementId, onError, reportScan, syncCapabilities],
  );

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      try {
        const discovered = await Html5Qrcode.getCameras();
        if (!mountedRef.current) return;

        const uniqueCameras = discovered.filter(
          (camera, index, array) => array.findIndex((candidate) => candidate.id === camera.id) === index,
        );
        setCameras(uniqueCameras);

        const preferred = pickPreferredCamera(uniqueCameras, localStorage.getItem(SCANNER_CAMERA_KEY));
        if (preferred) {
          setSelectedCameraId(preferred.id);
          localStorage.setItem(SCANNER_CAMERA_KEY, preferred.id);
          await startScanner(preferred.id, cameraLabel(preferred, uniqueCameras.indexOf(preferred)));
          return;
        }
      } catch (error) {
        const message = toScannerMessage(error);
        setStatus(message);
        onError?.(message);
      }

      await startScanner({ facingMode: 'environment' }, 'camera arriere');
    };

    void init();

    return () => {
      mountedRef.current = false;
      void stopScanner();
    };
  }, [onError, startScanner, stopScanner]);

  const handleCameraChange = async (cameraId: string) => {
    setSelectedCameraId(cameraId);
    localStorage.setItem(SCANNER_CAMERA_KEY, cameraId);
    const nextCamera = cameras.find((camera) => camera.id === cameraId);
    await startScanner(cameraId, nextCamera ? cameraLabel(nextCamera, cameras.indexOf(nextCamera)) : undefined);
  };

  const handleCycleCamera = async () => {
    if (cameras.length < 2) return;

    const currentIndex = Math.max(0, cameras.findIndex((camera) => camera.id === selectedCameraId));
    const nextCamera = cameras[(currentIndex + 1) % cameras.length];
    if (nextCamera) await handleCameraChange(nextCamera.id);
  };

  const handlePauseResume = () => {
    const scanner = scannerRef.current;
    if (!scanner) return;

    try {
      if (paused) {
        scanner.resume();
        setPaused(false);
        setStatus('Scan repris');
      } else {
        scanner.pause(true);
        setPaused(true);
        setStatus('Scan en pause');
      }
    } catch (error) {
      const message = toScannerMessage(error);
      setStatus(message);
      onError?.(message);
    }
  };

  const handleTorchToggle = async () => {
    const scanner = scannerRef.current;
    if (!scanner || !torchSupported) return;

    try {
      const capability = scanner.getRunningTrackCameraCapabilities().torchFeature();
      const next = !torchEnabled;
      await capability.apply(next);
      setTorchEnabled(next);
      setStatus(next ? 'Lampe activee' : 'Lampe desactivee');
    } catch (error) {
      const message = toScannerMessage(error);
      setStatus(message);
      onError?.(message);
    }
  };

  const handleZoomChange = async (value: number) => {
    const scanner = scannerRef.current;
    setZoomValue(value);
    if (!scanner || !zoomSupported) return;

    try {
      const capability = scanner.getRunningTrackCameraCapabilities().zoomFeature();
      await capability.apply(value);
    } catch (error) {
      const message = toScannerMessage(error);
      setStatus(message);
      onError?.(message);
    }
  };

  const restartCameraWithTuning = async (nextTuning: ScannerTuning) => {
    tuningRef.current = nextTuning;
    setTuning(nextTuning);
    setTuningDirty(false);

    if (selectedCameraId) {
      const nextCamera = cameras.find((camera) => camera.id === selectedCameraId);
      await startScanner(selectedCameraId, nextCamera ? cameraLabel(nextCamera, cameras.indexOf(nextCamera)) : undefined);
    } else {
      await startScanner({ facingMode: 'environment' }, 'camera arriere');
    }
  };

  const applyPreset = async (preset: ScanPreset) => {
    await restartCameraWithTuning({ ...PRESET_TUNING[preset] });
  };

  const updateTuning = (patch: Partial<Pick<ScannerTuning, 'boxWidthPct' | 'boxHeightPct'>>) => {
    setTuning((current) => {
      const next = {
        ...current,
        ...patch,
        boxWidthPct: clamp(Number(patch.boxWidthPct ?? current.boxWidthPct), 55, 100),
        boxHeightPct: clamp(Number(patch.boxHeightPct ?? current.boxHeightPct), 16, 60),
      };
      tuningRef.current = next;
      return next;
    });
    setTuningDirty(true);
  };

  const applyCurrentTuning = async () => {
    await restartCameraWithTuning(tuningRef.current);
  };

  const handleFileScan = async (file: File | null | undefined) => {
    if (!file) return;

    setStarting(true);
    setPaused(false);
    setStatus('Lecture du code depuis l’image...');

    await stopScanner();
    if (!mountedRef.current) return;

    const scanner = new Html5Qrcode(elementId, {
      verbose: false,
      formatsToSupport: SUPPORTED_FORMATS,
      useBarCodeDetectorIfSupported: true,
    });
    scannerRef.current = scanner;

    let shouldRestartCamera = false;

    try {
      const decodedText = await scanner.scanFile(file, false);
      reportScan(decodedText, 'image');
    } catch (error) {
      shouldRestartCamera = true;
      const message = toScannerMessage(error);
      setStatus(`Image non lisible. ${message}`);
      onError?.(message);
    } finally {
      try {
        scanner.clear();
      } catch {
        // ignore UI clear errors
      }
      if (scannerRef.current === scanner) scannerRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (mountedRef.current && shouldRestartCamera) {
        if (selectedCameraId) {
          const nextCamera = cameras.find((camera) => camera.id === selectedCameraId);
          await startScanner(selectedCameraId, nextCamera ? cameraLabel(nextCamera, cameras.indexOf(nextCamera)) : undefined);
        } else {
          await startScanner({ facingMode: 'environment' }, 'camera arriere');
        }
      } else if (mountedRef.current) {
        setStarting(false);
      }
    }
  };

  const submitManualCode = () => {
    reportScan(manualCode, 'manual');
  };

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm sm:p-4">
      <div
        className="flex h-[min(96dvh,880px)] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 id="scanner-title" className="text-base font-semibold text-slate-900 sm:text-lg">Scanner code-barres</h3>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Mode 100cm, cadre reglable, zoom, torche, image et saisie de secours.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800"
            aria-label="Fermer le scanner"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="relative min-h-[250px] bg-slate-950 sm:min-h-[340px] lg:min-h-0">
            <div
              id={elementId}
              className="h-full w-full overflow-hidden [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div
                className="min-h-[72px] min-w-[220px] max-w-[96%] rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(2,6,23,0.48)]"
                style={{
                  width: `${tuning.boxWidthPct}%`,
                  height: `${tuning.boxHeightPct}%`,
                  maxHeight: '360px',
                }}
              />
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent px-4 pb-4 pt-10 text-white sm:px-5 sm:pb-5">
              <div className="text-sm font-medium">Gardez le code stable dans le cadre blanc</div>
              <div className="mt-1 text-xs text-slate-300">Mode {PRESET_LABELS[tuning.preset]} actif: EAN, UPC, CODE-128, CODE-39, ITF, Data Matrix et QR.</div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
            <div className="space-y-3 overflow-y-auto p-4 custom-scrollbar sm:p-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Statut</div>
                <div className="mt-1 text-sm font-medium text-slate-800">{status}</div>
                {lastDecoded && <div className="mt-2 text-xs text-slate-500">Dernier code: {lastDecoded}</div>}
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Crosshair className="h-4 w-4 text-slate-500" />
                  Mode lecture
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {SCAN_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                        tuning.preset === preset
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                      onClick={() => void applyPreset(preset)}
                      disabled={starting && tuning.preset === preset}
                    >
                      {PRESET_LABELS[preset]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Ruler className="h-4 w-4 text-slate-500" />
                    Cadre
                  </div>
                  <span className="text-xs font-medium text-slate-500">
                    {tuning.boxWidthPct}% x {tuning.boxHeightPct}%
                  </span>
                </div>
                <label className="label !mb-1">Largeur</label>
                <input
                  type="range"
                  min={55}
                  max={100}
                  step={1}
                  value={tuning.boxWidthPct}
                  onChange={(event) => updateTuning({ boxWidthPct: Number(event.target.value) })}
                  className="w-full accent-brand-600"
                />
                <label className="label !mb-1 mt-3">Hauteur</label>
                <input
                  type="range"
                  min={16}
                  max={60}
                  step={1}
                  value={tuning.boxHeightPct}
                  onChange={(event) => updateTuning({ boxHeightPct: Number(event.target.value) })}
                  className="w-full accent-brand-600"
                />
                <button
                  type="button"
                  className="btn-primary mt-3 w-full"
                  onClick={() => void applyCurrentTuning()}
                  disabled={!tuningDirty || starting}
                >
                  {tuningDirty ? 'Appliquer le cadre' : 'Cadre actif'}
                </button>
              </div>

              {cameras.length > 1 && (
                <div>
                  <label className="label">Camera</label>
                  <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                    <select
                      className="input"
                      value={selectedCameraId}
                      onChange={(event) => void handleCameraChange(event.target.value)}
                      disabled={starting}
                    >
                      {cameras.map((camera, index) => (
                        <option key={camera.id} value={camera.id}>
                          {cameraLabel(camera, index)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-secondary !px-0"
                      onClick={() => void handleCycleCamera()}
                      disabled={starting}
                      aria-label="Changer de camera"
                      title="Changer de camera"
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary" onClick={handlePauseResume} disabled={starting || !scannerRef.current}>
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {paused ? 'Reprendre' : 'Pause'}
                </button>
                <button type="button" className="btn-secondary" onClick={handleTorchToggle} disabled={starting || !torchSupported}>
                  {torchEnabled ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                  {torchEnabled ? 'Lampe off' : 'Lampe on'}
                </button>
              </div>

              {zoomSupported && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="label !mb-0">Zoom</label>
                    <span className="text-xs font-medium text-slate-500">x{zoomValue.toFixed(1)}</span>
                  </div>
                  <input
                    type="range"
                    min={zoomMin}
                    max={zoomMax}
                    step={zoomStep}
                    value={zoomValue}
                    onChange={(event) => void handleZoomChange(Number(event.target.value))}
                    className="w-full accent-brand-600"
                  />
                </div>
              )}

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ImageUp className="h-4 w-4 text-slate-500" />
                  Scanner une image
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Pratique pour les photos de produits, les etiquettes froissees ou les iPad sans bonne mise au point.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(event) => void handleFileScan(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className="btn-secondary mt-3 w-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={starting}
                >
                  <Camera className="h-4 w-4" />
                  Choisir / prendre photo
                </button>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-sm font-semibold text-slate-900">Saisie manuelle</div>
                <p className="mt-1 text-xs text-slate-500">
                  Utilisez cette option si la camera est indisponible ou si le code est partiellement endommage.
                </p>
                <div className="mt-3 space-y-2">
                  <input
                    className="input"
                    placeholder="EAN, UPC, CODE-128 ou référence"
                    value={manualCode}
                    onChange={(event) => setManualCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submitManualCode();
                      }
                    }}
                  />
                  <button type="button" className="btn-primary w-full" onClick={submitManualCode} disabled={!manualCode.trim()}>
                    Utiliser ce code
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-xs text-slate-500">
              Conseil: en mode 100cm, utilisez une bonne lumiere, gardez le code immobile une seconde, puis augmentez la hauteur du cadre si l'etiquette sort de la zone.
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
