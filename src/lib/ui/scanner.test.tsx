import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createQrDecoder,
  hasNativeBarcodeDetector,
  isValidPaymentCode,
  isValidStudentNumber,
  parseScannedCode,
  Scanner,
} from "./scanner";

const jsQRMock = vi.hoisted(() => vi.fn());
vi.mock("jsqr", () => ({ default: jsQRMock }));

const VALID_CODE = "fp1-ABCDEFGHJKMNPQRSTVWXYZ0123";

describe("payment-code validation", () => {
  test("accepts a well-formed fp1 code", () => {
    expect(isValidPaymentCode(VALID_CODE)).toBe(true);
    expect(isValidPaymentCode(`  ${VALID_CODE}  `)).toBe(true);
  });

  test("rejects wrong prefix, length, alphabet, and junk", () => {
    expect(isValidPaymentCode("fp2-ABCDEFGHJKMNPQRSTVWXYZ0123")).toBe(false);
    expect(isValidPaymentCode("fp1-ABCDEFGHJKMNPQRSTVWXYZ012")).toBe(false);
    expect(isValidPaymentCode("fp1-ILOUabcdefghjkmnpqrstvwxyz")).toBe(false);
    expect(isValidPaymentCode("https://example.com")).toBe(false);
    expect(isValidPaymentCode("")).toBe(false);
  });

  test("parseScannedCode wraps a valid code and rejects the rest", () => {
    expect(parseScannedCode(VALID_CODE)).toEqual({ paymentCode: VALID_CODE });
    expect(parseScannedCode("nope")).toBeNull();
  });

  test("student number is digits only", () => {
    expect(isValidStudentNumber("123456")).toBe(true);
    expect(isValidStudentNumber(" 123456 ")).toBe(true);
    expect(isValidStudentNumber("12a")).toBe(false);
    expect(isValidStudentNumber("")).toBe(false);
  });
});

describe("decoder selection", () => {
  const original = (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;

  afterEach(() => {
    if (original === undefined) {
      delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    } else {
      (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector = original;
    }
    jsQRMock.mockReset();
  });

  test("uses native BarcodeDetector when present", async () => {
    const detect = vi.fn().mockResolvedValue([{ rawValue: VALID_CODE }]);
    const options: unknown[] = [];
    class FakeDetector {
      constructor(opts: unknown) {
        options.push(opts);
      }
      detect = detect;
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeDetector;

    expect(hasNativeBarcodeDetector()).toBe(true);
    const decode = await createQrDecoder();
    const result = await decode({} as HTMLVideoElement, {} as HTMLCanvasElement);

    expect(options).toEqual([{ formats: ["qr_code"] }]);
    expect(result).toBe(VALID_CODE);
    expect(jsQRMock).not.toHaveBeenCalled();
  });

  test("falls back to the bundled jsQR decoder when absent", async () => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    jsQRMock.mockReturnValue({ data: VALID_CODE });

    expect(hasNativeBarcodeDetector()).toBe(false);
    const decode = await createQrDecoder();

    const ctx = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 })),
    };
    const canvas = { getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    const video = { videoWidth: 2, videoHeight: 2 } as HTMLVideoElement;

    const result = await decode(video, canvas);

    expect(jsQRMock).toHaveBeenCalledOnce();
    expect(result).toBe(VALID_CODE);
  });

  test("fallback decoder returns null with no frame available", async () => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    const decode = await createQrDecoder();
    const canvas = { getContext: vi.fn(() => null) } as unknown as HTMLCanvasElement;
    const video = { videoWidth: 0, videoHeight: 0 } as HTMLVideoElement;

    expect(await decode(video, canvas)).toBeNull();
    expect(jsQRMock).not.toHaveBeenCalled();
  });
});

describe("Scanner component", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  test("number pad is always visible before the camera is used", () => {
    render(<Scanner onIdentify={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Scan QR code" })).toBeInTheDocument();
    for (const digit of ["0", "1", "5", "9"]) {
      expect(screen.getByRole("button", { name: `Digit ${digit}` })).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Student number")).toBeInTheDocument();
  });

  test("typing digits and submitting identifies the buyer by student number", async () => {
    const onIdentify = vi.fn();
    render(<Scanner onIdentify={onIdentify} />);

    const submit = screen.getByRole("button", { name: "Look up student" });
    expect(submit).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Digit 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Digit 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Digit 3" }));

    expect(screen.getByLabelText("Student number")).toHaveValue("123");
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(onIdentify).toHaveBeenCalledWith({ studentNumber: "123" });
  });

  test("backspace removes the last digit and is disabled when empty", async () => {
    render(<Scanner onIdentify={vi.fn()} />);
    const back = screen.getByRole("button", { name: "Delete last digit" });
    expect(back).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Digit 7" }));
    await userEvent.click(screen.getByRole("button", { name: "Digit 8" }));
    await userEvent.click(back);

    expect(screen.getByLabelText("Student number")).toHaveValue("7");
  });

  test("the field strips non-digits from direct typing", async () => {
    render(<Scanner onIdentify={vi.fn()} />);
    const field = screen.getByLabelText("Student number");
    await userEvent.type(field, "12a3b4");
    expect(field).toHaveValue("1234");
  });

  test("shows an unsupported message when the device has no camera API", async () => {
    render(<Scanner onIdentify={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/can't open the camera/i);
  });

  test("shows a denied message when camera permission is refused", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    render(<Scanner onIdentify={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Scan QR code" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/camera access was blocked/i),
    );
  });
});
