"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useT } from "@/lib/context/LanguageContext";
import { cn } from "@/lib/utils";

interface Props {
  onScanSuccess: (barcode: string) => void;
  onScanError?: (error: string) => void;
}

export default function BarcodeScanner({ onScanSuccess, onScanError }: Props) {
  const t = useT();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const [struggling, setStruggling] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const startPromiseRef = useRef<Promise<unknown> | null>(null);
  const firedRef = useRef(false);
  const struggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanRegionId = "barcode-scanner-region";

  useEffect(() => {
    // getUserMedia only exists in secure contexts (HTTPS, localhost, or the
    // Capacitor app). Over plain http on a LAN IP the camera can never start.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorMsg(t.nutritionTracker.scannerInsecure);
      return;
    }

    firedRef.current = false;

    // Slight timeout to let DOM render
    const timer = setTimeout(() => {
      try {
        const html5Qrcode = new Html5Qrcode(scanRegionId);
        scannerRef.current = html5Qrcode;

        const qrboxFunction = (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdgePercentage = 0.85;
          const boxWidth = Math.floor(viewfinderWidth * minEdgePercentage);
          return {
            width: boxWidth,
            // 1D barcodes are wide and short — a shallow box improves detection
            height: Math.max(100, Math.floor(boxWidth * 0.4)),
          };
        };

        const config = {
          fps: 10,
          qrbox: qrboxFunction,
          // High resolution is essential: EAN-13 bars are unresolvable at the
          // default 640x480 on most phone cameras.
          videoConstraints: {
            facingMode: "environment",
            width:  { min: 640, ideal: 1920 },
            height: { min: 480, ideal: 1080 },
          },
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
          ],
          // The native BarcodeDetector path (experimentalFeatures.useBarCodeDetectorIfSupported)
          // reports as "supported" on many Android WebViews whose underlying shape-detection
          // service isn't actually wired up — it then silently returns zero decodes forever,
          // with no error. Forcing the bundled JS decoder is slower per-frame but always works.
        };

        const startPromise = html5Qrcode
          .start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
              // Decode callbacks can fire several times per second — only
              // deliver the first hit, then stop the camera.
              if (firedRef.current) return;
              firedRef.current = true;
              if (struggleTimerRef.current) clearTimeout(struggleTimerRef.current);
              stopScanner().finally(() => onScanSuccess(decodedText));
            },
            () => {
              // Verbose error/no-match feedback (ignored to prevent spamming logs)
            }
          )
          .then(() => {
            setScannerActive(true);

            try {
              const caps = html5Qrcode.getRunningTrackCapabilities();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if ((caps as any)?.torch) setTorchSupported(true);
            } catch { /* not all browsers expose track capabilities */ }

            // If nothing decodes after a while, nudge the user toward manual entry
            // instead of leaving them staring at a silently-failing camera view.
            struggleTimerRef.current = setTimeout(() => setStruggling(true), 12000);
          })
          .catch((err) => {
            console.error("Failed to start Html5Qrcode scanner:", err);
            setErrorMsg(t.nutritionTracker.scannerNoCamera);
            onScanError?.(String(err));
          });
        startPromiseRef.current = startPromise;
      } catch (e: any) {
        console.error("Html5Qrcode initialization failed:", e);
        setErrorMsg(e.message || t.nutritionTracker.scannerNoCamera);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      if (struggleTimerRef.current) clearTimeout(struggleTimerRef.current);
      // Wait for a pending start() before stopping — stopping mid-start
      // leaves the camera stream running with no way to release it.
      const pending = startPromiseRef.current;
      (async () => {
        try {
          if (pending) await pending;
          await stopScanner();
        } catch { /* already stopped */ }
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScanner = async () => {
    if (struggleTimerRef.current) clearTimeout(struggleTimerRef.current);
    const scanner = scannerRef.current;
    if (scanner && scanner.isScanning) {
      try {
        await scanner.stop();
        scanner.clear();
      } catch (err) {
        console.error("Failed to stop scanner:", err);
      }
    }
    setScannerActive(false);
  };

  const toggleTorch = async () => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    try {
      const next = !torchOn;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await scanner.applyVideoConstraints({ advanced: [{ torch: next } as any] });
      setTorchOn(next);
    } catch (err) {
      console.error("Failed to toggle torch:", err);
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[16/10] bg-[#0c0c0c] border border-[var(--border)] rounded-2xl overflow-hidden">
        {/* Scanner target container */}
        <div id={scanRegionId} className="w-full h-full" />

        {!scannerActive && !errorMsg && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted)]">
            {t.nutritionTracker.scannerStarting}
          </div>
        )}

        {errorMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/85">
            <span className="text-xl mb-2">📷</span>
            <p className="text-xs text-red-400 font-medium max-w-xs">{errorMsg}</p>
            <p className="text-[10px] text-[var(--muted)] mt-2">
              You can type the barcode number in the search bar above instead.
            </p>
          </div>
        )}

        {/* Framing guide overlay */}
        {scannerActive && (
          <div className="absolute inset-0 border-[3px] border-dashed border-[var(--accent)]/30 pointer-events-none rounded-2xl m-3 flex items-center justify-center">
            <div className="w-[200px] h-[80px] border-2 border-[var(--accent)] rounded-lg shadow-[0_0_15px_rgba(34,211,238,0.2)] flex items-center justify-center">
              <span className="text-[9px] font-mono tracking-widest text-[var(--accent)] bg-black/60 px-1.5 py-0.5 rounded uppercase leading-none">
                Align Barcode
              </span>
            </div>
          </div>
        )}

        {scannerActive && torchSupported && (
          <button
            type="button"
            onClick={toggleTorch}
            className={cn(
              "absolute bottom-2.5 right-2.5 w-9 h-9 rounded-full flex items-center justify-center text-base transition-colors",
              torchOn ? "bg-[var(--accent)] text-[#041a1f]" : "bg-black/60 text-white"
            )}
            aria-label="Toggle flashlight"
          >
            🔦
          </button>
        )}
      </div>

      <p className="text-[10px] text-[var(--faint)] text-center">
        Position the food product's barcode within the central guidelines.
      </p>

      {scannerActive && struggling && (
        <p className="text-[10px] text-amber-500 text-center">
          {t.nutritionTracker.scannerStruggling}
        </p>
      )}
    </div>
  );
}
