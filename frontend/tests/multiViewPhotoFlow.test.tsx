import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { MultiViewPhotoController } from "../src/hooks/useMultiViewPhotos";

const { mockReconstruct, mockDetect } = vi.hoisted(() => ({
  mockReconstruct: vi.fn(),
  mockDetect: vi.fn(),
}));

vi.mock("../src/services/faceLandmarker", () => ({
  detectFaceLandmarks: mockDetect,
}));

vi.mock("../src/services/multiViewReconstruction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/multiViewReconstruction")>();
  return { ...actual, reconstructFaceFromMultiView: mockReconstruct };
});

import { useMultiViewPhotos } from "../src/hooks/useMultiViewPhotos";
import { MultiViewPhotoManager } from "../src/components/MultiViewPhotoManager";
import { ReconstructionPanel } from "../src/components/ReconstructionPanel";
import { parseCanonicalFaceModel, type CanonicalFaceModel } from "../src/services/canonicalFaceModel";
import type { ReconstructionResult } from "../src/services/multiViewReconstruction";
import { ALL_VIEWS, REQUIRED_VIEWS, OPTIONAL_VIEWS, VIEW_LABELS, type PatientPhoto } from "../src/lib/multiViewPhoto";

const OBJ_PATH = join(process.cwd(), "public", "models", "canonical_face_model.obj");

function loadCanonical(): CanonicalFaceModel {
  return parseCanonicalFaceModel(readFileSync(OBJ_PATH, "utf8"));
}

/**
 * jsdom neither decodes images nor implements object URLs. A tiny fake image
 * lets the upload pipeline run exactly as in the browser.
 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 900;
  naturalHeight = 1200;
  width = 900;
  height = 1200;
  private _src = "";
  set src(value: string) {
    this._src = value;
    setTimeout(() => this.onload?.(), 0);
  }
  get src(): string {
    return this._src;
  }
}

const originalImage = globalThis.Image;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

beforeEach(() => {
  globalThis.Image = FakeImage as unknown as typeof Image;
  URL.createObjectURL = vi.fn(() => `blob:${Math.random().toString(16).slice(2)}`);
  URL.revokeObjectURL = vi.fn();
  mockDetect.mockReset();
  mockDetect.mockImplementation(async () => {
    const points = [];
    for (let i = 0; i < 478; i += 1) {
      points.push({ x: 0.5 + (i % 40) * 0.005, y: 0.4 + Math.floor(i / 40) * 0.01, z: 0.01 });
    }
    return points;
  });
});

afterEach(() => {
  globalThis.Image = originalImage;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  vi.clearAllMocks();
});

function makeFile(name = "photo.jpg"): File {
  return new File(["binary"], name, { type: "image/jpeg" });
}

/**
 * Renders the manager inside the same React tree as the hook, so the manager
 * always sees the current collection - exactly like in the application.
 */
function PhotoManagerHarness({
  onController,
}: {
  onController: (controller: MultiViewPhotoController) => void;
}) {
  const controller = useMultiViewPhotos();
  onController(controller);
  return (
    <MultiViewPhotoManager
      photos={controller}
      isOpen={true}
      onAcceptPhotos={() => {}}
      onCancel={() => {}}
    />
  );
}

describe("photo manager upload flow", () => {
  it("opens the file picker of the view whose Upload button was pressed", async () => {
    let controller: MultiViewPhotoController | null = null;
    render(
      <PhotoManagerHarness
        onController={(c) => {
          controller = c;
        }}
      />,
    );
    expect(controller).toBeTruthy();

    const frontInput = document.querySelector(
      'input[data-view="front"]',
    ) as HTMLInputElement;
    const profileInput = document.querySelector(
      'input[data-view="left-profile"]',
    ) as HTMLInputElement;
    expect(frontInput).toBeTruthy();
    expect(profileInput).toBeTruthy();

    const frontSpy = vi.spyOn(frontInput, "click");
    const profileSpy = vi.spyOn(profileInput, "click");

    const uploadButtons = screen.getAllByText("Upload");
    // The first card is the front view, the second the left profile.
    fireEvent.click(uploadButtons[0]);
    expect(frontSpy).toHaveBeenCalledTimes(1);
    expect(profileSpy).not.toHaveBeenCalled();

    fireEvent.click(uploadButtons[1]);
    expect(profileSpy).toHaveBeenCalledTimes(1);
  });

  it("stores the photo, detects the landmarks and bumps the collection version", async () => {
    let controller: MultiViewPhotoController | null = null;
    render(
      <PhotoManagerHarness
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    const versionBefore = controller!.version;

    await act(async () => {
      await controller!.uploadPhoto("front", makeFile());
    });

    await waitFor(() => {
      expect(controller!.photos.get("front")?.file).toBeTruthy();
    });
    expect(controller!.photos.get("front")?.landmarks?.length).toBe(478);
    expect(controller!.photos.get("front")?.validation.faceDetected).toBe(true);
    expect(controller!.version).toBeGreaterThan(versionBefore);
  });

  it("removes a single photo, releases the object URL and bumps the version", async () => {
    let controller: MultiViewPhotoController | null = null;
    render(
      <PhotoManagerHarness
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      await controller!.uploadPhoto("front", makeFile());
    });
    const versionAfterUpload = controller!.version;

    await act(async () => {
      controller!.removePhoto("front");
    });

    expect(controller!.photos.get("front")?.file).toBeFalsy();
    expect(controller!.photos.get("front")?.landmarks).toBeNull();
    expect(controller!.version).toBeGreaterThan(versionAfterUpload);
    // The object URL of the removed photo must have been revoked.
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("clears every photo at once", async () => {
    let controller: MultiViewPhotoController | null = null;
    render(
      <PhotoManagerHarness
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      await controller!.uploadPhoto("front", makeFile());
      await controller!.uploadPhoto("left-profile", makeFile());
    });
    expect(controller!.uploadedCount).toBe(2);

    await act(async () => {
      controller!.clearAllPhotos();
    });

    expect(controller!.uploadedCount).toBe(0);
    for (const view of ALL_VIEWS) {
      expect(controller!.photos.get(view)?.file).toBeFalsy();
    }
  });

  it("keeps the reconstruction possible when a required view has no detected face", async () => {
    // The bundled detector does not fire on a true side profile. The photo set
    // must still be usable instead of deadlocking the user.
    mockDetect.mockImplementation(async () => null);

    let controller: MultiViewPhotoController | null = null;
    render(
      <PhotoManagerHarness
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      await controller!.uploadPhoto("front", makeFile());
      await controller!.uploadPhoto("left-profile", makeFile());
    });

    expect(controller!.usableViewCount).toBe(0);
    expect(controller!.canReconstruct).toBe(false);
    expect(controller!.missingRequiredViews).toEqual([
      "front",
      "left-profile",
      "right-profile",
    ]);

    // The reason is explained instead of a bare "no face".
    expect(controller!.photos.get("front")?.landmarkError).toMatch(/50°/);
    expect(document.body.textContent).toMatch(/turned at most about 50°/);
  });

  it("allows the reconstruction with two usable views and names the missing one", async () => {
    let controller: MultiViewPhotoController | null = null;
    render(
      <PhotoManagerHarness
        onController={(c) => {
          controller = c;
        }}
      />,
    );

    await act(async () => {
      await controller!.uploadPhoto("front", makeFile());
      await controller!.uploadPhoto("left-three-quarter", makeFile());
    });

    expect(controller!.usableViewCount).toBe(2);
    expect(controller!.canReconstruct).toBe(true);
    expect(controller!.hasAllRequiredPhotos).toBe(false);
    expect(controller!.missingRequiredViews).toEqual(["left-profile", "right-profile"]);

    // The missing required views are reported, not silently ignored.
    expect(document.body.textContent).toContain("Missing usable views");
    expect(document.body.textContent).toContain("Left profile");
    expect(document.body.textContent).toContain("Right profile");
    // The action stays available.
    expect(screen.getByText(/Accept & Reconstruct/)).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Reconstruction panel                                                        */
/* -------------------------------------------------------------------------- */

function stubPhoto(view: string): PatientPhoto {
  return {
    view: view as PatientPhoto["view"],
    file: makeFile(`${view}.jpg`),
    previewUrl: `blob:${view}`,
    landmarks: Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
    validation: {
      ok: true,
      error: "",
      warnings: [],
      faceDetected: true,
      imageDimensions: { width: 900, height: 1200 },
    },
    landmarkDetectionStatus: "complete",
    landmarkError: "",
  };
}

function stubController(version: number): MultiViewPhotoController {
  const photos = new Map<string, PatientPhoto>();
  for (const view of ["front", "left-profile", "right-profile"]) {
    photos.set(view, stubPhoto(view));
  }
  return {
    photos: photos as unknown as MultiViewPhotoController["photos"],
    status: "ready",
    error: "",
    validationResult: null,
    isReconstructing: false,
    reconstructionProgress: 0,
    reconstructionError: "",
    version,
    uploadPhoto: vi.fn(),
    removePhoto: vi.fn(),
    retryLandmarkDetection: vi.fn(),
    clearAllPhotos: vi.fn(),
    startReconstruction: vi.fn(),
    setReconstructionProgress: vi.fn(),
    finishReconstruction: vi.fn(),
    getPhoto: (view: string) => photos.get(view),
    canReconstruct: true,
    uploadedCount: 3,
    usableViewCount: 3,
    missingRequiredViews: [],
    hasAllRequiredPhotos: true,
    requiredViews: REQUIRED_VIEWS,
    optionalViews: OPTIONAL_VIEWS,
    allViews: ALL_VIEWS,
    viewLabels: VIEW_LABELS,
  } as unknown as MultiViewPhotoController;
}

function successfulResult(): ReconstructionResult {
  const canonical = loadCanonical();
  return {
    success: true,
    error: "",
    warnings: [],
    canonicalModel: canonical,
    canonicalShape: new Float32Array(canonical.positions),
    canonicalDeltas: new Float32Array(canonical.positions.length),
    faceMorph: {
      faceWidth: 0.1,
      faceLength: 0,
      foreheadHeight: 0,
      jawWidth: 0,
      chinWidth: 0,
      chinLength: 0,
      cheekFullness: 0,
      eyeSpacing: 0,
      eyeSize: 0,
      eyeHeight: 0,
      browHeight: 0,
      noseWidth: 0,
      noseLength: 0,
      noseTip: 0.1,
      mouthWidth: 0,
      lipFullness: 0,
    },
    qualityMetrics: {
      overallScore: 0.82,
      landmarkCoverage: 1,
      viewCoverage: 1,
      fittingErrorPx: 1.2,
      maxFittingErrorPx: 2.4,
      normalisedError: 0.01,
      identityMagnitudeCm: 0.4,
      symmetryScore: 0.95,
      depthConsistency: 0.9,
      perView: [],
    },
    viewsUsed: ["front", "left-profile", "right-profile"],
    fit: null,
  };
}

describe("reconstruction panel", () => {
  beforeEach(() => {
    mockReconstruct.mockReset();
    mockReconstruct.mockImplementation(async () => successfulResult());
  });

  it("shows the reconstructed mesh in a 3D preview and applies it", async () => {
    const controller = stubController(4);
    const onApply = vi.fn();

    render(
      <ReconstructionPanel
        photos={controller}
        isOpen={true}
        onApplyReconstruction={onApply}
        onBackToPhotos={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Start Reconstruction"));

    await waitFor(() => {
      expect(screen.getByText("Reconstructed Face")).toBeTruthy();
    });

    // The preview really renders the reconstructed triangles.
    const svg = document.querySelector("svg.preview3d__canvas") as SVGElement;
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll("polygon").length).toBeGreaterThan(100);

    // The camera can be switched to the profiles.
    fireEvent.click(screen.getByText("Left profile"));
    expect(svg.querySelectorAll("polygon").length).toBeGreaterThan(100);

    fireEvent.click(screen.getByText("Apply to Simulation"));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].success).toBe(true);
  });

  it("blocks applying a reconstruction whose photos have changed", async () => {
    const controller = stubController(4);
    const onApply = vi.fn();

    const { rerender } = render(
      <ReconstructionPanel
        photos={controller}
        isOpen={true}
        onApplyReconstruction={onApply}
        onBackToPhotos={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("Start Reconstruction"));
    await waitFor(() => {
      expect(screen.getByText("Reconstructed Face")).toBeTruthy();
    });

    // The user replaces a photo: the collection version moves on.
    rerender(
      <ReconstructionPanel
        photos={stubController(5)}
        isOpen={true}
        onApplyReconstruction={onApply}
        onBackToPhotos={() => {}}
        onCancel={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Outdated")).toBeTruthy();
    });

    const applyButton = screen.getByText("Apply to Simulation").closest("button")!;
    expect(applyButton.disabled).toBe(true);

    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("keeps the consultation and offers a retry when the fit fails", async () => {
    mockReconstruct.mockImplementation(async () => ({
      ...successfulResult(),
      success: false,
      error: "Not enough usable views were found to reconstruct a 3D face.",
      canonicalShape: null,
      faceMorph: null,
    }));

    const controller = stubController(1);
    const onCancel = vi.fn();

    render(
      <ReconstructionPanel
        photos={controller}
        isOpen={true}
        onApplyReconstruction={vi.fn()}
        onBackToPhotos={() => {}}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByText("Start Reconstruction"));

    await waitFor(() => {
      expect(screen.getByText("Reconstruction Failed")).toBeTruthy();
    });
    expect(
      screen.getByText("Not enough usable views were found to reconstruct a 3D face."),
    ).toBeTruthy();
    // The user can retry or go back to the photos; nothing is applied.
    expect(screen.getByText("Try Again")).toBeTruthy();
    expect(screen.getByText("Back to Photos")).toBeTruthy();
  });
});
