import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface ScannerModalProps {
  onScan: (decodedText: string) => void;
  onClose: () => void;
  onError?: (error: string) => void;
}

export function ScannerModal({ onScan, onClose, onError }: ScannerModalProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    scannerRef.current = new Html5Qrcode('qr-reader');
    const startScanner = async () => {
      try {
        await scannerRef.current?.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            onScan(decodedText);
          },
          (_errorMessage) => {
            // ignore scan frame errors
          }
        );
      } catch (err) {
        if (onError) onError(err instanceof Error ? err.message : 'Failed to start scanner');
      }
    };
    
    startScanner();

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [onScan, onError]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-slate-50">
          <h3 className="font-semibold text-slate-800">Scanner le Code-Barres</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="p-4 bg-black">
          <div id="qr-reader" className="w-full"></div>
        </div>
        <div className="p-4 flex justify-end bg-slate-50 border-t">
          <button onClick={onClose} className="btn-secondary">Fermer</button>
        </div>
      </div>
    </div>
  );
}
