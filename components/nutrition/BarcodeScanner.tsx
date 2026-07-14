"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useT } from "@/lib/context/LanguageContext";

interface Props {
  onScanSuccess: (barcode: string) => void;
  onScanError?: (error: string) => void;
}

export default function BarcodeScanner({ onScanSuccess, onScanError }: Props) {
  const t = useT();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [scannerActive, setScannerActive] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scanRegionId = "barcode-scanner-region";

  useEffect(() => {
    // Start scanner automatically on mount
    setScannerActive(true);
    
    // Slight timeout to let DOM render
    const timer = setTimeout(() => {
      try {
        const html5Qrcode = new Html5Qrcode(scanRegionId);
        scannerRef.current = html5Qrcode;

        const qrboxFunction = (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdgePercentage = 0.75;
          const minEdgeSize = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = Math.floor(minEdgeSize * minEdgePercentage);
          return {
            width: qrboxSize,
            height: Math.max(100, Math.floor(qrboxSize * 0.6))
          };
        };

        const config = {
          fps: 10,
          qrbox: qrboxFunction,
          aspectRatio: 1.777778, // 16:9 widescreen
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
          ],
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
          }
        };

        html5Qrcode
          .start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
              // On success
              onScanSuccess(decodedText);
              // Stop scanning immediately on match
              stopScanner();
            },
            () => {
              // Verbose error/no-match feedback (ignored to prevent spamming logs)
            }
          )
          .catch((err) => {
            console.error("Failed to start Html5Qrcode scanner:", err);
            setErrorMsg("Camera access permission denied or camera not found.");
            onScanError?.(err);
          });
      } catch (e: any) {
        console.error("Html5Qrcode initialization failed:", e);
        setErrorMsg(e.message || "Failed to initialize barcode scanner.");
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScanner = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
      } catch (err) {
        console.error("Failed to stop scanner:", err);
      }
    }
    setScannerActive(false);
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[16/10] bg-[#0c0c0c] border border-[var(--border)] rounded-2xl overflow-hidden">
        {/* Scanner target container */}
        <div id={scanRegionId} className="w-full h-full" />

        {!scannerActive && !errorMsg && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--muted)]">
            Scanner stopped.
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
      </div>

      <p className="text-[10px] text-[var(--faint)] text-center">
        Position the food product's barcode within the central guidelines.
      </p>
    </div>
  );
}
