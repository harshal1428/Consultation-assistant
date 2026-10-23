import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCommandAPI } from "../src/services/api";
import type { ContextItem } from "../src/scene/transformations/types";

const context: ContextItem[] = [
  { target: "nasal_bridge", parameter: "height", operation: "decrease", value: 1, unit: "mm" },
  { target: "nasal_tip", parameter: "height", operation: "raise", value: 1, unit: "mm" },
  { target: "nasal_tip", parameter: "rotation", operation: "rotate", value: 5, unit: "degrees" },
  { target: "nasal_bridge", parameter: "width", operation: "narrow", value: 1, unit: "mm" },
  { target: "nasal_bridge", parameter: "height", operation: "increase", value: 2, unit: "mm" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCommandAPI", () => {
  it("posts the text and a bounded context slice", async () => {
    const response = { instructions: [], text: "hi" };
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);

    const result = await parseCommandAPI("reduce it", context);

    expect(result).toEqual(response);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toBe("reduce it");
    expect(body.context).toHaveLength(4);
    expect(body.context[body.context.length - 1].value).toBe(2);
  });

  it("throws the backend detail on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ detail: "Could not extract any instruction" }),
      }),
    );
    await expect(parseCommandAPI("x")).rejects.toThrow(
      "Could not extract any instruction",
    );
  });

  it("reports a clear error when the service is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(parseCommandAPI("x")).rejects.toThrow(/Could not reach/);
  });

  it("rejects an unexpected response shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: true }) }),
    );
    await expect(parseCommandAPI("x")).rejects.toThrow(/unexpected response/);
  });
});
