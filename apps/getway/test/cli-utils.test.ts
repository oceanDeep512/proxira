import { describe, expect, it } from "vitest";
import {
  detectOS,
  getInstallGuide,
  getInstallCommand,
  resolveHostFlag,
  validateCertDays,
  validateCommonName,
  type OSType,
} from "../src/cli-utils.js";

describe("cli-utils", () => {
  describe("detectOS", () => {
    it("detects macOS from darwin platform", () => {
      expect(detectOS("darwin")).toBe("macos");
    });

    it("detects Windows from win32 platform", () => {
      expect(detectOS("win32")).toBe("windows");
    });

    it("detects Linux from linux platform", () => {
      expect(detectOS("linux")).toBe("linux");
    });

    it("returns unknown for other platforms", () => {
      expect(detectOS("freebsd")).toBe("unknown");
      expect(detectOS("sunos")).toBe("unknown");
    });
  });

  describe("getInstallGuide", () => {
    it("returns macOS guide with Homebrew instructions", () => {
      const guide = getInstallGuide("macos");
      expect(guide.title).toContain("macOS");
      expect(guide.steps.join(" ")).toContain("brew install");
    });

    it("returns Windows guide with Chocolatey instructions", () => {
      const guide = getInstallGuide("windows");
      expect(guide.title).toContain("Windows");
      expect(guide.steps.join(" ")).toContain("choco install");
    });

    it("returns Linux guide with apt instructions", () => {
      const guide = getInstallGuide("linux");
      expect(guide.title).toContain("Linux");
      expect(guide.steps.join(" ")).toContain("apt-get install");
    });

    it("returns unknown OS guide", () => {
      const guide = getInstallGuide("unknown");
      expect(guide.steps.join(" ")).toContain("https://www.openssl.org/");
    });
  });

  describe("getInstallCommand", () => {
    it("returns brew install for macOS with Homebrew", () => {
      const command = getInstallCommand("macos", true, false, false);
      expect(command).toBe("brew install openssl");
    });

    it("returns null for macOS without Homebrew", () => {
      const command = getInstallCommand("macos", false, false, false);
      expect(command).toBeNull();
    });

    it("returns choco install for Windows with Chocolatey", () => {
      const command = getInstallCommand("windows", false, true, false);
      expect(command).toBe("choco install openssl");
    });

    it("returns null for Windows without Chocolatey", () => {
      const command = getInstallCommand("windows", false, false, false);
      expect(command).toBeNull();
    });

    it("returns apt install for Linux with apt", () => {
      const command = getInstallCommand("linux", false, false, true);
      expect(command).not.toBeNull();
    });

    it("returns null for Linux without apt", () => {
      const command = getInstallCommand("linux", false, false, false);
      expect(command).toBeNull();
    });

    it("returns null for unknown OS", () => {
      const command = getInstallCommand("unknown", true, true, true);
      expect(command).toBeNull();
    });
  });

  describe("validateCertDays", () => {
    it("uses default 365 days when undefined", () => {
      expect(validateCertDays(undefined)).toBe(365);
    });

    it("parses valid positive integer", () => {
      expect(validateCertDays("730")).toBe(730);
      expect(validateCertDays("1")).toBe(1);
    });

    it("throws for zero", () => {
      expect(() => validateCertDays("0")).toThrow("必须是正整数");
    });

    it("throws for negative number", () => {
      expect(() => validateCertDays("-100")).toThrow("必须是正整数");
    });

    it("throws for non-numeric value", () => {
      expect(() => validateCertDays("invalid")).toThrow();
    });
  });

  describe("validateCommonName", () => {
    it("uses default localhost when undefined", () => {
      expect(validateCommonName(undefined)).toBe("localhost");
    });

    it("uses default localhost when empty string", () => {
      expect(validateCommonName("")).toBe("localhost");
      expect(validateCommonName("   ")).toBe("localhost");
    });

    it("trims whitespace from input", () => {
      expect(validateCommonName("  myapp.local  ")).toBe("myapp.local");
    });

    it("returns valid common name as-is", () => {
      expect(validateCommonName("myapp.local")).toBe("myapp.local");
      expect(validateCommonName("api.example.com")).toBe("api.example.com");
    });
  });

  describe("resolveHostFlag", () => {
    it("treats a bare --host as the lan alias", () => {
      // `proxira --host` == `proxira --host lan`
      expect(resolveHostFlag(undefined, undefined)).toEqual({
        value: "lan",
        consumesNext: false,
      });
    });

    it("does not swallow the next flag as a value", () => {
      expect(resolveHostFlag(undefined, "--port")).toEqual({
        value: "lan",
        consumesNext: false,
      });
      expect(resolveHostFlag(undefined, "-p")).toEqual({
        value: "lan",
        consumesNext: false,
      });
    });

    it("consumes the next token when it really is a value", () => {
      expect(resolveHostFlag(undefined, "192.168.1.4")).toEqual({
        value: "192.168.1.4",
        consumesNext: true,
      });
      expect(resolveHostFlag(undefined, "0.0.0.0")).toEqual({
        value: "0.0.0.0",
        consumesNext: true,
      });
    });

    it("uses the inline value when present", () => {
      expect(resolveHostFlag("10.0.0.2", undefined)).toEqual({
        value: "10.0.0.2",
        consumesNext: false,
      });
    });

    it("treats an empty inline value as the lan alias", () => {
      expect(resolveHostFlag("", undefined)).toEqual({
        value: "lan",
        consumesNext: false,
      });
      expect(resolveHostFlag("   ", undefined)).toEqual({
        value: "lan",
        consumesNext: false,
      });
    });
  });
});
