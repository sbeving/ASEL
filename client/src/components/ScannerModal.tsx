import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface ScannerModalProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  onError?: (error: string) => void;
}

interface CameraDeviceOption {
  id: string;
  label: string;
}

const SCANNER_CAMERA_KEY = 'asel-pos-scanner-camera';
const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE,
];

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
      if (/(wide|ultra)/.test(label)) score += 20;
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

export function ScannerModal({ onScan, onClose, onError }: ScannerModalProps) {
  const reactId = useId();
  const elementId = useMemo(() => `barcode-reader-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [reactId]);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const mountedRef = useRef(true);
  const opRef = useRef(0);
  const scanRef = useRef({ text: '', at: 0 });

  const [cameras, setCameras] = useState<CameraDeviceOption[]>([]);
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
        const nextValue = zoom.value() ?? nextMin;
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
        await scanner.start(
          cameraChoice,
          {
            fps: 14,
            aspectRatio: 16 / 9,
            disableFlip: true,
            qrbox: (viewfinderWidth, viewfinderHeight) => ({
              width: Math.max(220, Math.min(Math.floor(viewfinderWidth * 0.88), 460)),
              height: Math.max(110, Math.min(Math.floor(viewfinderHeight * 0.34), 190)),
            }),
          },
          (decodedText) => {
            const now = Date.now();
            if (scanRef.current.text === decodedText && now - scanRef.current.at < 1500) return;
            scanRef.current = { text: decodedText, at: now };
            setLastDecoded(decodedText);
            setStatus(`Code detecte: ${decodedText}`);
            navigator.vibrate?.(40);
            onScan(decodedText);
          },
          () => {
            // ignore frame-level misses
          },
        );

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
        setStarting(false);
        setStatus(message);
        onError?.(message);
      }
    },
    [elementId, onError, onScan, syncCapabilities],
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

  const submitManualCode = () => {
    const code = manualCode.trim();
    if (!code) return;
    setLastDecoded(code);
    setStatus(`Code manuel utilise: ${code}`);
    onScan(code);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[min(92vh,860px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Scanner code-barres</h3>
            <p className="mt-1 text-sm text-slate-500">
              Optimise pour POS, camera arriere, zoom, torche et saisie manuelle de secours.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-3 py-1 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
          >
            Fermer
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="relative min-h-[360px] bg-slate-950">
            <div id={elementId} className="h-full w-full" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="h-[32%] w-[88%] rounded-[2rem] border-2 border-white/85 shadow-[0_0_0_9999px_rgba(2,6,23,0.42)]" />
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent px-5 pb-5 pt-10 text-white">
              <div className="text-sm font-medium">Cadrez le code-barres dans la zone centrale</div>
              <div className="mt-1 text-xs text-slate-300">EAN-13, EAN-8, CODE-128, UPC, ITF et QR sont pris en charge.</div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col border-t border-slate-200 bg-white lg:border-l lg:border-t-0">
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Statut</div>
                <div className="mt-1 text-sm font-medium text-slate-800">{status}</div>
                {lastDecoded && <div className="mt-2 text-xs text-slate-500">Dernier code: {lastDecoded}</div>}
              </div>

              {cameras.length > 1 && (
                <div>
                  <label className="label">Camera</label>
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
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary" onClick={handlePauseResume} disabled={starting || !scannerRef.current}>
                  {paused ? 'Reprendre' : 'Pause'}
                </button>
                <button type="button" className="btn-secondary" onClick={handleTorchToggle} disabled={starting || !torchSupported}>
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

              <div className="rounded-2xl border border-slate-200 p-4">
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
              Conseil enterprise: privilégiez la camera arrière principale, augmentez le zoom pour les petits codes et passez en saisie manuelle si l'éclairage est insuffisant.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
