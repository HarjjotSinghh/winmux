import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  clampFontSize,
} from "./font";

describe("clampFontSize", () => {
  it("passes through in-range sizes", () => {
    expect(clampFontSize(12)).toBe(12);
    expect(clampFontSize(14)).toBe(14);
  });

  it("clamps to the supported range", () => {
    expect(clampFontSize(2)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(100)).toBe(MAX_FONT_SIZE);
  });

  it("rounds fractional sizes", () => {
    expect(clampFontSize(14.6)).toBe(15);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FONT_SIZE);
  });
});
