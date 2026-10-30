import { describe, expect, it } from "vitest";
import { encodeWavMono } from "../src/lib/wav";

describe("encodeWavMono", () => {
  it("writes a valid mono 16-bit PCM WAV header and samples", () => {
    const buffer = encodeWavMono(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000);
    const view = new DataView(buffer);
    const text = (offset: number, length: number) =>
      String.fromCharCode(
        ...new Uint8Array(buffer, offset, length),
      );

    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(10);
    expect(buffer.byteLength).toBe(54);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBeGreaterThan(16000);
    expect(view.getInt16(48, true)).toBeLessThan(0);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });

  it("clamps out-of-range samples", () => {
    const buffer = encodeWavMono(new Float32Array([2, -2]), 16000);
    const view = new DataView(buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});
