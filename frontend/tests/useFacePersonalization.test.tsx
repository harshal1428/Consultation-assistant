import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFacePersonalization } from "../src/hooks/useFacePersonalization";
import { detectFaceLandmarks } from "../src/services/faceLandmarker";
import { FACE_LANDMARK_INDEX } from "../src/services/faceReconstruction";
import type { FaceLandmarkPoint } from "../src/services/faceReconstruction";

vi.mock("../src/services/faceLandmarker", () => ({
  detectFaceLandmarks: vi.fn(),
}));

const detect = vi.mocked(detectFaceLandmarks);

function buildLandmarks(): FaceLandmarkPoint[] {
  const pts: FaceLandmarkPoint[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  const set = (index: number, x: number, y: number) => {
    pts[index] = { x, y, z: 0 };
  };
  const idx = FACE_LANDMARK_INDEX;
  set(idx.foreheadTop, 0.5, 0.2);
  set(idx.chinBottom, 0.5, 0.85);
  set(idx.faceRight, 0.28, 0.5);
  set(idx.faceLeft, 0.72, 0.5);
  set(idx.jawRight, 0.32, 0.6);
  set(idx.jawLeft, 0.68, 0.6);
  set(idx.chinRight, 0.42, 0.8);
  set(idx.chinLeft, 0.58, 0.8);
  set(idx.eyeRightOuter, 0.34, 0.5);
  set(idx.eyeRightInner, 0.44, 0.5);
  set(idx.eyeLeftInner, 0.56, 0.5);
  set(idx.eyeLeftOuter, 0.66, 0.5);
  set(idx.irisRight, 0.41, 0.5);
  set(idx.irisLeft, 0.59, 0.5);
  set(idx.browRight, 0.4, 0.45);
  set(idx.browLeft, 0.6, 0.45);
  set(idx.noseBridge, 0.5, 0.46);
  set(idx.noseTip, 0.5, 0.58);
  set(idx.subnasale, 0.5, 0.62);
  set(idx.alarRight, 0.44, 0.62);
  set(idx.alarLeft, 0.56, 0.62);
  set(idx.mouthRight, 0.42, 0.72);
  set(idx.mouthLeft, 0.58, 0.72);
  set(idx.upperLipTop, 0.5, 0.7);
  set(idx.lowerLipBottom, 0.5, 0.75);
  return pts;
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 400;
  naturalHeight = 400;
  width = 400;
  height = 400;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

function makeFile(name = "face.png", type = "image/png"): File {
  return new File(["pixels"], name, { type });
}

beforeEach(() => {
  detect.mockReset();
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image);
  if (typeof URL.createObjectURL !== "function") {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:preview",
    });
  }
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFacePersonalization", () => {
  it("reconstructs a personalization from an uploaded photo", async () => {
    detect.mockResolvedValue(buildLandmarks());
    const { result } = renderHook(() => useFacePersonalization());

    act(() => result.current.upload(new File(["x"], "jane.png", { type: "image/png" })));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.personalization).not.toBeNull();
    expect(result.current.personalization?.photoName).toBe("jane");
    expect(result.current.personalization?.morph).toBeDefined();
    expect(result.current.personalization?.skinTone).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result.current.previewUrl).toMatch(/^blob:/);
  });

  it("rejects an unsupported file without running detection", () => {
    const { result } = renderHook(() => useFacePersonalization());
    act(() =>
      result.current.upload(new File(["x"], "a.pdf", { type: "application/pdf" })),
    );
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/unsupported file type/i);
    expect(detect).not.toHaveBeenCalled();
  });

  it("reports an error when no face is detected", async () => {
    detect.mockResolvedValue(null);
    const { result } = renderHook(() => useFacePersonalization());
    act(() => result.current.upload(new File(["x"], "x.png", { type: "image/png" })));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/no face was detected/i);
    expect(result.current.personalization).toBeNull();
  });

  it("ignores a stale detection after the photo is removed", async () => {
    let resolveDetect: ((value: FaceLandmarkPoint[] | null) => void) | null = null;
    detect.mockImplementation(
      () =>
        new Promise<FaceLandmarkPoint[] | null>((resolve) => {
          resolveDetect = resolve;
        }),
    );
    const { result } = renderHook(() => useFacePersonalization());
    act(() => result.current.upload(new File(["x"], "x.png", { type: "image/png" })));
    act(() => result.current.remove());

    await act(async () => {
      resolveDetect?.(buildLandmarks());
      await Promise.resolve();
    });

    expect(result.current.personalization).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("retries the stored photo after a transient error", async () => {
    detect.mockResolvedValueOnce(null).mockResolvedValueOnce(buildLandmarks());
    const { result } = renderHook(() => useFacePersonalization());
    act(() => result.current.upload(new File(["x"], "x.png", { type: "image/png" })));
    await waitFor(() => expect(result.current.status).toBe("error"));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.personalization).not.toBeNull();
  });
});
