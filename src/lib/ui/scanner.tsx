"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/lib/ui/vendor/button";

export type BuyerId = { paymentCode: string } | { studentNumber: string };

const PAYMENT_CODE_RE = /^fp1-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;
const STUDENT_NUMBER_RE = /^[0-9]+$/;
const STUDENT_NUMBER_MAX = 12;

export function isValidPaymentCode(raw: string): boolean {
  return PAYMENT_CODE_RE.test(raw.trim());
}

export function isValidStudentNumber(raw: string): boolean {
  return STUDENT_NUMBER_RE.test(raw.trim());
}

export function parseScannedCode(raw: string): BuyerId | null {
  const code = raw.trim();
  return isValidPaymentCode(code) ? { paymentCode: code } : null;
}

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

export type QrDecoder = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
) => Promise<string | null>;

export function hasNativeBarcodeDetector(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

export async function createQrDecoder(): Promise<QrDecoder> {
  if (hasNativeBarcodeDetector()) {
    const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor })
      .BarcodeDetector;
    const detector = new Detector({ formats: ["qr_code"] });
    return async (video) => {
      const codes = await detector.detect(video);
      return codes[0]?.rawValue ?? null;
    };
  }
  const { default: jsQR } = await import("jsqr");
  return async (video, canvas) => {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx || !video.videoWidth || !video.videoHeight) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(data, width, height)?.data ?? null;
  };
}

type CameraState = "idle" | "starting" | "scanning" | "denied" | "unsupported" | "error";

const CAMERA_MESSAGE: Record<Exclude<CameraState, "idle" | "starting" | "scanning">, string> = {
  denied: "Camera access was blocked. Enter the student number below instead.",
  unsupported: "This device can't open the camera. Enter the student number below instead.",
  error: "The camera couldn't start. Enter the student number below instead.",
};

const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export function Scanner({
  onIdentify,
  className,
}: {
  onIdentify: (buyer: BuyerId) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const decoderRef = useRef<QrDecoder | null>(null);
  const rafRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const onIdentifyRef = useRef(onIdentify);
  useEffect(() => {
    onIdentifyRef.current = onIdentify;
  }, [onIdentify]);

  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [scanHint, setScanHint] = useState("");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [pad, setPad] = useState("");

  function stopCamera() {
    scanningRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackRef.current = null;
    decoderRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setTorchAvailable(false);
    setTorchOn(false);
  }

  useEffect(() => stopCamera, []);

  function scanLoop() {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const decode = decoderRef.current;
    const schedule = () => {
      if (scanningRef.current) rafRef.current = requestAnimationFrame(scanLoop);
    };
    if (!video || !canvas || !decode) {
      schedule();
      return;
    }
    decode(video, canvas)
      .then((raw) => {
        if (!scanningRef.current) return;
        if (raw) {
          const buyer = parseScannedCode(raw);
          if (buyer) {
            stopCamera();
            setCameraState("idle");
            onIdentifyRef.current(buyer);
            return;
          }
          setScanHint("That code isn't a FraserPay payment code.");
        }
        schedule();
      })
      .catch(schedule);
  }

  async function startCamera() {
    setScanHint("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }
    setCameraState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        setCameraState("error");
        return;
      }
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const capabilities = (
        track as MediaStreamTrack & { getCapabilities?: () => MediaTrackCapabilities }
      )?.getCapabilities?.();
      setTorchAvailable(Boolean(capabilities && "torch" in capabilities));
      decoderRef.current = await createQrDecoder();
      scanningRef.current = true;
      setCameraState("scanning");
      scanLoop();
    } catch (error) {
      stopCamera();
      setCameraState((error as DOMException)?.name === "NotAllowedError" ? "denied" : "error");
    }
  }

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  function pressKey(key: string) {
    setPad((current) => (current + key).slice(0, STUDENT_NUMBER_MAX));
  }

  function submitPad() {
    const value = pad.trim();
    if (!isValidStudentNumber(value)) return;
    stopCamera();
    setCameraState("idle");
    onIdentifyRef.current({ studentNumber: value });
  }

  const scanning = cameraState === "scanning";
  const cameraMessage =
    cameraState === "denied" || cameraState === "unsupported" || cameraState === "error"
      ? CAMERA_MESSAGE[cameraState]
      : "";

  return (
    <div className={className}>
      <section aria-label="Scan payment QR code" className="flex flex-col gap-3">
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black/90">
          <video
            ref={videoRef}
            playsInline
            muted
            className={scanning ? "size-full object-cover" : "hidden"}
          />
          {!scanning && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
              {cameraState === "starting"
                ? "Starting camera…"
                : "Point the camera at the student's wallet QR code."}
            </div>
          )}
        </div>
        <canvas ref={canvasRef} className="hidden" />

        <div className="flex flex-wrap gap-2">
          {scanning ? (
            <>
              <Button type="button" variant="outline" onClick={stopCamera}>
                Stop camera
              </Button>
              {torchAvailable && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={toggleTorch}
                  aria-pressed={torchOn}
                >
                  {torchOn ? "Torch on" : "Torch off"}
                </Button>
              )}
            </>
          ) : (
            <Button type="button" onClick={startCamera} disabled={cameraState === "starting"}>
              Scan QR code
            </Button>
          )}
        </div>

        {cameraMessage && (
          <p role="status" className="text-sm text-muted">
            {cameraMessage}
          </p>
        )}
        {scanning && scanHint && (
          <p role="status" aria-live="polite" className="text-sm text-muted">
            {scanHint}
          </p>
        )}
      </section>

      <section aria-label="Enter student number" className="mt-6 flex flex-col gap-3">
        <label htmlFor="scanner-student-number" className="text-sm font-medium text-foreground">
          Or enter student number
        </label>
        <input
          id="scanner-student-number"
          inputMode="numeric"
          autoComplete="off"
          value={pad}
          onChange={(event) =>
            setPad(event.target.value.replace(/\D/g, "").slice(0, STUDENT_NUMBER_MAX))
          }
          className="h-12 rounded-md border border-border bg-background px-4 text-center text-2xl tracking-widest text-foreground"
          aria-label="Student number"
        />
        <div className="grid grid-cols-3 gap-2">
          {PAD_KEYS.map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              className="h-14 text-xl"
              onClick={() => pressKey(key)}
              aria-label={`Digit ${key}`}
            >
              {key}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            className="h-14 text-xl"
            onClick={() => setPad((current) => current.slice(0, -1))}
            disabled={pad.length === 0}
            aria-label="Delete last digit"
          >
            ⌫
          </Button>
        </div>
        <Button type="button" size="lg" onClick={submitPad} disabled={!isValidStudentNumber(pad)}>
          Look up student
        </Button>
      </section>
    </div>
  );
}
