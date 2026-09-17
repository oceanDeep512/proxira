import { describe, expect, it } from "vitest";
import { normalizeGroupName, normalizeTimeout } from "../src/groups/utils.js";

describe("groups/utils", () => {
  describe("normalizeGroupName", () => {
    it("returns the trimmed name when one is provided", () => {
      expect(normalizeGroupName("  本地后端  ", 3)).toBe("本地后端");
    });

    // Regression: the fallback must keep the index. A rename once dropped it and
    // produced "转发地址 " (trailing space, no index) for every unnamed target,
    // which broke both hydration and the exported `groupName`.
    it("appends the fallback index when the name is empty", () => {
      expect(normalizeGroupName("", 1)).toBe("转发地址 1");
      expect(normalizeGroupName("   ", 2)).toBe("转发地址 2");
      expect(normalizeGroupName("", 7)).toBe("转发地址 7");
    });

    it("is not affected by a non-empty name with an index", () => {
      expect(normalizeGroupName("默认转发地址", 9)).toBe("默认转发地址");
    });
  });

  describe("normalizeTimeout", () => {
    it("treats non-positive and non-finite values as no override", () => {
      expect(normalizeTimeout(null)).toBeNull();
      expect(normalizeTimeout(undefined)).toBeNull();
      expect(normalizeTimeout(0)).toBeNull();
      expect(normalizeTimeout(-1)).toBeNull();
      expect(normalizeTimeout(Number.NaN)).toBeNull();
      expect(normalizeTimeout(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it("floors valid timeouts", () => {
      expect(normalizeTimeout(1500)).toBe(1500);
      expect(normalizeTimeout(1500.9)).toBe(1500);
    });
  });
});
